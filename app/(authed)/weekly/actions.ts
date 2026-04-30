"use server";

import { createServerClient } from "@/lib/supabase/server";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { generateWeeklyDigest } from "@/app/(authed)/weekly-digest/actions";

/**
 * Send the weekly counterpart digest to the campaign's counterpart email.
 *
 * This is an INTERNAL operational email (founder → counterpart), NOT
 * outreach to a prospect. The counterpart is a known colleague (e.g.
 * fractional fundraise manager, co-founder) whose email is stored in
 * campaigns.counterpart_email.
 *
 * The approval gate in CLAUDE.md does NOT apply to this path — it is
 * the same class as weekly-digest-cron.mjs (sends to a known internal
 * recipient, not an investor/customer prospect).
 */

export type SendToCounterpartResult =
  | { ok: true; to: string; subject: string }
  | { ok: false; error: string };

export async function sendWeeklyDigestToCounterpart(input: {
  campaignId: string;
  customBody?: string;
}): Promise<SendToCounterpartResult> {
  const { campaignId, customBody } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "not signed in" };

  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select("id, name, counterpart_email, counterpart_name")
    .eq("id", campaignId)
    .single();

  if (campaignErr || !campaign) {
    return { ok: false, error: `campaign fetch failed: ${campaignErr?.message ?? "not found"}` };
  }

  const counterpartEmail = (campaign as { counterpart_email: string | null }).counterpart_email;
  if (!counterpartEmail) {
    return {
      ok: false,
      error: "No counterpart email set on this campaign. Add one in campaign settings first.",
    };
  }

  let subject: string;
  let body: string;

  if (customBody) {
    subject = `[WEEKLY UPDATE] ${campaign.name}`;
    body = customBody;
  } else {
    const digest = await generateWeeklyDigest({ campaignId });
    if (!digest.ok) return { ok: false, error: digest.error };
    subject = digest.subject;
    body = digest.body;
  }

  try {
    await sendGmailMessage({
      to: counterpartEmail,
      subject,
      body,
    });
    return { ok: true, to: counterpartEmail, subject };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `gmail send failed: ${msg}` };
  }
}
