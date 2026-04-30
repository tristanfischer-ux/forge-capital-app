import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "@/lib/gmail/oauth";

/**
 * Vercel Cron — Gmail inbound sync.
 *
 * Replaces scripts/gmail-sync.mjs (launchd every 15 min).
 * Polls each connected user's Gmail for messages to/from any
 * campaign_partners email, upserts into contact_events keyed on
 * gmail_message_id.
 *
 * Schedule: every 15 minutes
 */

export const maxDuration = 300;

const BACKFILL_DAYS = 14;
const BATCH_EMAILS_PER_QUERY = 20;
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// ---------- Gmail API helpers ----------

async function gmailFetch(
  accessToken: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      `Gmail GET ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`,
    );
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

interface GmailMessageStub {
  id: string;
  threadId?: string;
}

async function listMessageIds(
  accessToken: string,
  query: string,
): Promise<GmailMessageStub[]> {
  const ids: GmailMessageStub[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await gmailFetch(
      accessToken,
      `/gmail/v1/users/me/messages?${params.toString()}`,
    );
    for (const m of (json.messages as GmailMessageStub[] | undefined) ?? []) {
      ids.push(m);
    }
    pageToken = json.nextPageToken as string | undefined;
    if (ids.length >= 500) break;
  } while (pageToken);
  return ids;
}

async function getMessageMetadata(
  accessToken: string,
  id: string,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date", "X-Failed-Recipients"]) {
    params.append("metadataHeaders", h);
  }
  return gmailFetch(
    accessToken,
    `/gmail/v1/users/me/messages/${id}?${params.toString()}`,
  );
}

// ---------- Message classification ----------

interface HeaderEntry {
  name?: string;
  value?: string;
}

function headerValue(headers: HeaderEntry[] | undefined, name: string): string | null {
  const row = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return row?.value || null;
}

function classifyMessage(
  msg: Record<string, unknown>,
  partnerEmail: string,
): { direction: string; eventType: string } | null {
  const labelIds = (msg.labelIds as string[]) || [];
  const payload = msg.payload as { headers?: HeaderEntry[] } | undefined;
  const headers = payload?.headers || [];
  const from = (headerValue(headers, "From") || "").toLowerCase();

  const isSent = labelIds.includes("SENT");
  const isInbox = labelIds.includes("INBOX");
  const isChat = labelIds.includes("CHAT");

  // bounce signals
  const xFailed = headerValue(headers, "X-Failed-Recipients");
  if (
    xFailed ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster@") ||
    from.includes("mail delivery subsystem")
  ) {
    return { direction: "bounce", eventType: "bounce" };
  }

  // auto-reply heuristic
  const subject = (headerValue(headers, "Subject") || "").toLowerCase();
  if (
    subject.startsWith("out of office") ||
    subject.startsWith("auto-reply") ||
    subject.startsWith("automatic reply") ||
    subject.includes("out of the office")
  ) {
    return { direction: "auto_reply", eventType: "ooo" };
  }

  if (isSent) return { direction: "outbound", eventType: "sent" };
  if (isInbox) return { direction: "inbound", eventType: "reply" };
  if (isChat) return null;
  if (partnerEmail && from.includes(partnerEmail.toLowerCase())) {
    return { direction: "inbound", eventType: "reply" };
  }
  return { direction: "outbound", eventType: "sent" };
}

// ---------- Helpers ----------

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- Main handler ----------

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const supabase = createAdminClient();

  // Load all gmail_tokens rows
  const { data: tokens, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select(
      "user_id, email, access_token, refresh_token, expires_at, scope, last_gmail_sync_at",
    );
  if (tokenErr) {
    return NextResponse.json(
      { error: `gmail_tokens read failed: ${tokenErr.message}` },
      { status: 500 },
    );
  }
  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ message: "No gmail_tokens rows — nothing to do", users: 0 });
  }

  // Load campaign partners with emails
  const partnersByEmail = new Map<string, string[]>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("campaign_partners")
      .select("id, partner_id, partners_mirror!inner(email)")
      .not("partners_mirror.email", "is", null)
      .range(from, from + pageSize - 1);
    if (error) {
      return NextResponse.json(
        { error: `campaign_partners read: ${error.message}` },
        { status: 500 },
      );
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const mirror = row.partners_mirror as { email?: string } | null;
      const email = mirror?.email?.trim()?.toLowerCase();
      if (!email) continue;
      if (!partnersByEmail.has(email)) partnersByEmail.set(email, []);
      partnersByEmail.get(email)!.push(row.id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const results: Record<string, unknown>[] = [];

  for (const tokenRow of tokens) {
    const userLabel = `${tokenRow.email} (${(tokenRow.user_id as string).slice(0, 8)}…)`;

    // Scope check
    const scope = ((tokenRow.scope as string) || "").split(/\s+/);
    if (!scope.includes(REQUIRED_SCOPE)) {
      await supabase
        .from("gmail_tokens")
        .update({
          last_gmail_sync_status: "scope_insufficient",
          last_gmail_sync_error:
            "Need gmail.readonly scope — reconnect at /api/auth/gmail",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", tokenRow.user_id);
      results.push({ user: userLabel, skipped: true, reason: "scope_insufficient" });
      continue;
    }

    // Ensure fresh access token
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
      results.push({
        user: userLabel,
        skipped: true,
        reason: "refresh_failed",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Cursor: previous sync timestamp, fallback to BACKFILL_DAYS ago
    const cursorMs = tokenRow.last_gmail_sync_at
      ? new Date(tokenRow.last_gmail_sync_at as string).getTime()
      : Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
    const afterEpoch = Math.floor(cursorMs / 1000);
    const runStartedAt = new Date();

    // Batch partners into Gmail-compatible OR queries
    const emails = [...partnersByEmail.keys()];
    const emailBatches = chunkArray(emails, BATCH_EMAILS_PER_QUERY);

    const seenMessageIds = new Set<string>();

    for (const batch of emailBatches) {
      const orClause = batch.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
      const q = `(${orClause}) after:${afterEpoch} -in:chat`;
      let ids: GmailMessageStub[] = [];
      try {
        ids = await listMessageIds(accessToken, q);
      } catch (err) {
        if ((err as Error & { status?: number }).status === 400) {
          const halves = chunkArray(batch, Math.ceil(batch.length / 2));
          for (const h of halves) {
            const orH = h.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
            try {
              const sub = await listMessageIds(
                accessToken,
                `(${orH}) after:${afterEpoch} -in:chat`,
              );
              ids.push(...sub);
            } catch {
              // sub-batch failed, continue
            }
          }
        } else {
          continue;
        }
      }
      for (const m of ids) {
        seenMessageIds.add(m.id);
      }
    }

    const messageIdList = [...seenMessageIds];
    let inserted = 0;
    let skipped = 0;
    let errored = 0;

    for (const messageId of messageIdList) {
      let meta: Record<string, unknown>;
      try {
        meta = await getMessageMetadata(accessToken, messageId);
      } catch {
        errored++;
        continue;
      }

      const payload = meta.payload as { headers?: HeaderEntry[] } | undefined;
      const headers = payload?.headers || [];
      const from = (headerValue(headers, "From") || "").toLowerCase();
      const to = (headerValue(headers, "To") || "").toLowerCase();
      const subject = headerValue(headers, "Subject") || "";
      const dateHeader = headerValue(headers, "Date");

      // Match to a partner email
      let partnerEmail: string | null = null;
      let campaignPartnerIds: string[] | null = null;
      for (const [email, ids] of partnersByEmail) {
        if (from.includes(email) || to.includes(email)) {
          partnerEmail = email;
          campaignPartnerIds = ids;
          break;
        }
      }
      if (!partnerEmail || !campaignPartnerIds?.length) {
        skipped++;
        continue;
      }

      const cls = classifyMessage(meta, partnerEmail);
      if (!cls) {
        skipped++;
        continue;
      }

      // event_at: prefer Gmail internalDate, fall back to Date header
      let eventAt = new Date();
      if (meta.internalDate) {
        eventAt = new Date(Number(meta.internalDate));
      } else if (dateHeader) {
        const parsed = Date.parse(dateHeader);
        if (!Number.isNaN(parsed)) eventAt = new Date(parsed);
      }

      const campaignPartnerId = campaignPartnerIds[0];
      const row = {
        campaign_partner_id: campaignPartnerId,
        direction: cls.direction,
        channel: "gmail",
        gmail_thread_id: (meta.threadId as string) || null,
        gmail_message_id: meta.id as string,
        event_type: cls.eventType,
        event_at: eventAt.toISOString(),
        summary: subject.slice(0, 500),
      };

      const { error } = await supabase
        .from("contact_events")
        .upsert(row, { onConflict: "gmail_message_id", ignoreDuplicates: true });
      if (error) {
        errored++;
      } else {
        inserted++;
      }
    }

    // Cursor-advance: only move forward when every message ingested cleanly
    const update: Record<string, unknown> = {
      last_gmail_sync_status: errored === 0 ? "ok" : "partial",
      last_gmail_sync_error:
        errored === 0 ? null : `${errored} message errors`,
      updated_at: new Date().toISOString(),
    };
    if (errored === 0) {
      update.last_gmail_sync_at = runStartedAt.toISOString();
    }
    await supabase
      .from("gmail_tokens")
      .update(update)
      .eq("user_id", tokenRow.user_id);

    results.push({
      user: userLabel,
      listed: seenMessageIds.size,
      inserted,
      skipped,
      errored,
    });
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  return NextResponse.json({
    message: `gmail-sync completed in ${dt}s`,
    users: tokens.length,
    partners: partnersByEmail.size,
    results,
  });
}
