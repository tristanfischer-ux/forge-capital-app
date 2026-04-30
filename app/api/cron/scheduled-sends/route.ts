import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import { verifyDeliverability } from "@/lib/email/verify-deliverability";

/**
 * Vercel Cron — Scheduled sends dispatcher.
 *
 * Replaces scripts/scheduled-sends-dispatcher.mjs (launchd every 60s loop).
 * Each invocation: find pending rows whose scheduled_for_utc <= now(),
 * atomically claim them, verify deliverability, send via Gmail API,
 * mirror to contact_events.
 *
 * Schedule: * * * * * (every minute)
 */

export const maxDuration = 60;

const BATCH_LIMIT = 10;

// ---------- Gmail helpers ----------

function encodeRfc2822Message(
  to: string,
  subject: string,
  body: string,
): string {
  const subjectHeader = /[^\x20-\x7e]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
    : subject;
  const message = [
    `To: ${to}`,
    `Subject: ${subjectHeader}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface GmailSendResult {
  id: string;
  threadId: string;
}

async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<GmailSendResult> {
  const raw = encodeRfc2822Message(to, subject, body);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Gmail send failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as GmailSendResult;
}

// ---------- Main handler ----------

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  // Find due rows
  const { data: due, error: queryErr } = await supabase
    .from("scheduled_sends")
    .select(
      "id, campaign_partner_id, to_email, subject, body, scheduled_for_utc",
    )
    .lte("scheduled_for_utc", nowIso)
    .eq("status", "pending")
    .order("scheduled_for_utc", { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryErr) {
    return NextResponse.json(
      { error: `poll failed: ${queryErr.message}` },
      { status: 500 },
    );
  }

  const rows = due ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ message: "No due rows", sent: 0, failed: 0 });
  }

  // Get sender access token (first/only gmail_tokens row)
  const { data: tokens, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select("user_id, email, access_token, refresh_token, expires_at, scope")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (tokenErr || !tokens || tokens.length === 0) {
    return NextResponse.json(
      {
        error:
          tokenErr?.message ??
          "No gmail_tokens row — connect Gmail at /api/auth/gmail first.",
      },
      { status: 500 },
    );
  }

  const tokenRow = tokens[0];
  let accessToken: string;
  try {
    const now = Date.now();
    const expires = tokenRow.expires_at
      ? new Date(tokenRow.expires_at as string).getTime()
      : 0;
    if (tokenRow.access_token && expires > now + 60_000) {
      accessToken = tokenRow.access_token as string;
    } else {
      const refreshed = await refreshAccessToken(tokenRow.refresh_token as string);
      const newExpires = new Date(
        now + refreshed.expires_in * 1000,
      ).toISOString();
      await supabase
        .from("gmail_tokens")
        .update({
          access_token: refreshed.access_token,
          expires_at: newExpires,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", tokenRow.user_id);
      accessToken = refreshed.access_token;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Cannot obtain Gmail access token: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    // Atomic claim: flip pending -> dispatching
    const { data: claimed, error: claimErr } = await supabase
      .from("scheduled_sends")
      .update({ status: "dispatching" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) {
      continue; // Another dispatcher claimed it, or founder cancelled
    }

    try {
      const verification = await verifyDeliverability(row.to_email);
      if (!verification.deliverable) {
        throw new Error(
          `Deliverability check failed: ${verification.reason}`,
        );
      }

      const gmailRes = await sendGmailMessage(
        accessToken,
        row.to_email,
        row.subject,
        row.body,
      );
      const sentAt = new Date().toISOString();

      await supabase
        .from("scheduled_sends")
        .update({
          status: "sent",
          sent_at: sentAt,
          gmail_thread_id: gmailRes.threadId || null,
          gmail_message_id: gmailRes.id || null,
        })
        .eq("id", row.id);

      // Mirror to contact_events
      await supabase.from("contact_events").insert({
        campaign_partner_id: row.campaign_partner_id,
        event_type: "scheduled_send",
        event_at: sentAt,
        direction: "outbound",
        channel: "gmail",
        gmail_thread_id: gmailRes.threadId || null,
        gmail_message_id: gmailRes.id || null,
        summary: row.subject.slice(0, 500),
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("scheduled_sends")
        .update({
          status: "failed",
          error_message: msg.slice(0, 2000),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return NextResponse.json({
    message: `Dispatched ${rows.length} row(s)`,
    sent,
    failed,
    total: rows.length,
  });
}
