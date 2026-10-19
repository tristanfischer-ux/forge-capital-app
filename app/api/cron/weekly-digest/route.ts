import { NextRequest, NextResponse } from "next/server";
import { buildWeeklyDigest } from "@/lib/digest/build-weekly-digest";
import { loadWeeklyDigest } from "@/lib/digest/load-weekly-digest";
import { refreshAccessToken } from "@/lib/gmail/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vercel Cron — Weekly founder digest.
 *
 * Shared builder: lib/digest/build-weekly-digest.ts
 * Schedule: 0 7 * * 1 (Monday 07:00 UTC)
 *
 * Guards:
 *   DIGEST_DRY_RUN=1  — build and return JSON; never refresh tokens or call Gmail.
 *   VERCEL_ENV must be "production" to send. Preview deployments return early.
 */

export const maxDuration = 300;

function base64UrlEncode(data: Buffer): string {
  return data
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<string> {
  const rawHeaders = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  const rawMessage = rawHeaders.join("\r\n") + "\r\n\r\n" + body;
  const encoded = base64UrlEncode(Buffer.from(rawMessage, "utf8"));
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Gmail send ${res.status}: ${(await res.text()).slice(0, 400)}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = process.env.DIGEST_DRY_RUN === "1";
  const supabase = createAdminClient();
  const now = new Date();

  const { data: campaignsData, error: campaignsErr } = await supabase
    .from("campaigns")
    .select(
      "id, name, campaign_intent, status, counterpart_email, counterpart_name",
    )
    .eq("status", "active");
  if (campaignsErr) {
    return NextResponse.json(
      { error: `campaigns fetch failed: ${campaignsErr.message}` },
      { status: 500 },
    );
  }
  const campaigns = campaignsData ?? [];
  if (campaigns.length === 0) {
    return NextResponse.json({
      message: "No active campaigns",
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  }

  const built: {
    campaignId: string;
    name: string;
    subject: string;
    body: string;
    stats: Record<string, number>;
  }[] = [];
  let failed = 0;
  for (const campaign of campaigns) {
    const loaded = await loadWeeklyDigest({
      campaignId: campaign.id,
      now,
      apex: supabase,
    });
    if (!loaded.ok) {
      failed++;
      continue;
    }
    const digest = buildWeeklyDigest(loaded.data, now);
    built.push({
      campaignId: campaign.id,
      name: campaign.name,
      subject: digest.subject,
      body: digest.body,
      stats: digest.stats,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      message: "Weekly digest dry-run (DIGEST_DRY_RUN=1) — not sent",
      campaigns: campaigns.length,
      failed,
      digests: built,
    });
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({
      message: "Weekly digest skipped — VERCEL_ENV is not production",
      vercel_env: process.env.VERCEL_ENV ?? null,
      campaigns: campaigns.length,
      built: built.length,
      failed,
      sent: 0,
      skipped: built.length,
    });
  }

  const { data: anyToken, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select("user_id, email, refresh_token")
    .limit(1);
  if (tokenErr || !anyToken || anyToken.length === 0) {
    return NextResponse.json(
      {
        error:
          tokenErr?.message ?? "No gmail_tokens row — connect Gmail first.",
      },
      { status: 500 },
    );
  }
  const token = anyToken[0];

  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(token.refresh_token as string);
    accessToken = refreshed.access_token;
    const newExpires = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();
    await supabase
      .from("gmail_tokens")
      .update({
        access_token: accessToken,
        expires_at: newExpires,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", token.user_id);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  let sent = 0;
  let skipped = 0;
  for (const digest of built) {
    if (!token.email) {
      skipped++;
      continue;
    }
    try {
      await sendMessage(
        accessToken,
        token.email as string,
        digest.subject,
        digest.body,
      );
      sent++;
    } catch (err) {
      console.error(
        `[weekly-digest] send failed ${digest.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  return NextResponse.json({
    message: `Weekly digest complete`,
    campaigns: campaigns.length,
    sent,
    failed,
    skipped,
  });
}
