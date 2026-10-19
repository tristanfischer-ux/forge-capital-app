"use server";

import { buildWeeklyDigest } from "@/lib/digest/build-weekly-digest";
import { canSendDigest } from "@/lib/digest/can-send";
import { loadWeeklyDigest } from "@/lib/digest/load-weekly-digest";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { createServerClient } from "@/lib/supabase/server";

export type WeeklyDigestStats = {
  sent: number;
  replies: number;
  repliesPositive: number;
  repliesNegative: number;
  repliesNeutral: number;
  meetings_booked: number;
  silent_over_7d: number;
  handovers: number;
  declines: number;
};

export type GenerateWeeklyDigestResult =
  | {
      ok: true;
      subject: string;
      body: string;
      stats: WeeklyDigestStats;
    }
  | { ok: false; error: string };

export type SendWeeklyDigestResult =
  | { ok: true; to: string; subject: string; gmailMessageId: string }
  | { ok: false; error: string };

export async function generateWeeklyDigest(input: {
  campaignId: string;
  now?: Date;
}): Promise<GenerateWeeklyDigestResult> {
  const { campaignId } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();
  const now = input.now ?? new Date();
  const loaded = await loadWeeklyDigest({
    campaignId,
    now,
    apex: supabase,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const digest = buildWeeklyDigest(loaded.data, now);
  return {
    ok: true,
    subject: digest.subject,
    body: digest.body,
    stats: digest.stats,
  };
}

/**
 * Convenience: generate + send to the authed user's own Gmail address
 * (from gmail_tokens.email). Button on /weekly-digest calls this.
 */
export async function sendWeeklyDigestToMe(input: {
  campaignId: string;
}): Promise<SendWeeklyDigestResult> {
  const gate = canSendDigest({
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!gate.ok) return { ok: false, error: gate.error };

  const digest = await generateWeeklyDigest(input);
  if (!digest.ok) return { ok: false, error: digest.error };

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "not signed in" };

  const { data: token, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select("email")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (tokenErr || !token?.email) {
    return {
      ok: false,
      error:
        "Gmail not connected — connect Gmail from /settings before sending the digest.",
    };
  }

  try {
    const res = await sendGmailMessage({
      to: token.email,
      subject: digest.subject,
      body: digest.body,
    });

    void supabase.from("weekly_digest_log").insert({
      campaign_id: input.campaignId,
      digest_type: "founder_digest",
      to_email: token.email,
      subject: digest.subject,
      body_preview: digest.body.slice(0, 300),
      gmail_message_id: res.id,
      created_by: auth.user.id,
    });

    return {
      ok: true,
      to: token.email,
      subject: digest.subject,
      gmailMessageId: res.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `gmail send failed: ${msg}` };
  }
}
