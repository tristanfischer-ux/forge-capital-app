"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getInvestorModalData } from "@/lib/queries/investorModal";
import { composeDraft } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/compose";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { refineSynthesisWithOpus } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/refineSynthesisAction";

/**
 * Server action: dispatch a batch of test-drafts to a review inbox.
 *
 * Picks the first `maxCount` pending-approval rows for the campaign,
 * runs each through the shared composer, and sends each to `toEmail`
 * with a `[TEST]` subject prefix + trailing test banner.
 *
 * The live tracker row status is NOT advanced — we only log a
 * `contact_events` row with kind `test_send` so the campaign's real
 * pipeline (+0 → +2 Drafted → +3 Email sent) stays untouched.
 *
 * Returns a summary per-row so the UI can show which firms succeeded
 * and which failed (and why).
 */

export interface SendTestBatchInput {
  campaignId: string;
  toEmail: string;
  maxCount: number;
}

export interface PerRowOutcome {
  campaignPartnerId: string;
  firmName: string | null;
  partnerName: string | null;
  ok: boolean;
  /** On success: Gmail thread URL; on failure: error text. */
  detail: string;
}

export type SendTestBatchResult =
  | {
      ok: true;
      sent: number;
      failed: number;
      rows: PerRowOutcome[];
    }
  | { ok: false; error: string };

const TEST_BATCH_TAG = "[TEST]";

export async function sendTestBatch(
  input: SendTestBatchInput,
): Promise<SendTestBatchResult> {
  const { campaignId, toEmail, maxCount } = input;
  if (!campaignId) return { ok: false, error: "campaignId is required." };
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { ok: false, error: "toEmail must be a valid email address." };
  }
  const capped = Math.max(1, Math.min(50, Math.floor(maxCount)));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Fetch up to `capped + buffer` pending rows — we allow skipping rows
  // that are tier-blocked, so grab extras.
  const { data: pending, error: pendingErr } = await supabase
    .from("campaign_partners")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status_code", "+0")
    .order("created_at", { ascending: true })
    .limit(capped + 10);

  if (pendingErr) {
    return {
      ok: false,
      error: `Pending-rows read failed: ${pendingErr.message}`,
    };
  }

  const pendingIds = (pending ?? []).map((r) => r.id as string);
  if (pendingIds.length === 0) {
    return {
      ok: false,
      error: "No +0 Pending approval rows on this campaign — shortlist first.",
    };
  }

  const outcomes: PerRowOutcome[] = [];

  for (const partnerId of pendingIds) {
    if (outcomes.filter((o) => o.ok).length >= capped) break;

    // Step 1: load partner data once (fast).
    let data = await getInvestorModalData(partnerId);
    if (!data) {
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName: null,
        partnerName: null,
        ok: false,
        detail: "getInvestorModalData returned null",
      });
      continue;
    }

    const firmName = data.investor.firm_name ?? "Unknown firm";
    const partnerName = data.primary_partner?.name ?? null;

    // Step 2: if this row has no rendered_synthesis OR no subject_angle
    // cached, run Opus before sending so no email goes out with a
    // generic template-substituted synthesis or a bland raw-
    // sector-focus subject angle. refineSynthesisWithOpus writes both
    // in one JSON call — adds ~3-5s per row (~60-100s for 20).
    if (!data.rendered_synthesis || !data.subject_angle) {
      const refined = await refineSynthesisWithOpus({
        campaignPartnerId: partnerId,
      });
      if (refined.ok) {
        // Re-load so composeDraft picks up the new rendered_synthesis.
        data = await getInvestorModalData(partnerId);
        if (!data) {
          outcomes.push({
            campaignPartnerId: partnerId,
            firmName,
            partnerName,
            ok: false,
            detail: "reload after refine returned null",
          });
          continue;
        }
      } else {
        // Refine failed (usually: missing thesis_summary). We record
        // the failure but DO NOT send — a generic template-subst'd
        // email with "{{FIRM_THESIS}}" literal would be worse than
        // skipping this row entirely.
        outcomes.push({
          campaignPartnerId: partnerId,
          firmName,
          partnerName,
          ok: false,
          detail: `Skipped — synthesis could not be generated: ${refined.error}`,
        });
        continue;
      }
    }

    const draft = composeDraft(data);

    const subject = `${TEST_BATCH_TAG} ${draft.subject}`.slice(0, 240);
    // Use the composer's fullBody — salutation + paragraphs + sign-off.
    // Previously sent just `bodyParagraphs.join`, which dropped both the
    // "Dear <Name>," greeting and the "Best regards, Tristan Fischer..."
    // sign-off. Tristan flagged this 2026-04-23 on batch #2.
    const body = [
      draft.fullBody,
      "",
      "— TEST —",
      "This is a TEST dispatch to a review inbox. No real investor received this message. Reply with 'ok / not for me / skip' style markers to simulate an approver response.",
    ].join("\n\n");

    try {
      const sent = await sendGmailMessage({
        to: toEmail,
        subject,
        body,
      });

      // Log to contact_events with event_type = test_send so the tracker
      // distinguishes dry runs from real sends. Real schema uses
      // event_type/event_at/summary/channel (not kind/occurred_at/subject).
      await supabase.from("contact_events").insert({
        campaign_partner_id: partnerId,
        event_type: "test_send",
        event_at: new Date().toISOString(),
        direction: "outbound",
        channel: "gmail",
        gmail_thread_id: sent.threadId,
        gmail_message_id: sent.id,
        summary: subject,
      });

      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: true,
        detail: `https://mail.google.com/mail/u/0/#sent/${sent.threadId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        campaignPartnerId: partnerId,
        firmName,
        partnerName,
        ok: false,
        detail: msg,
      });
    }
  }

  revalidatePath("/approval/test-send");
  revalidatePath("/approval");
  revalidatePath("/tracker");

  const sentCount = outcomes.filter((o) => o.ok).length;
  const failedCount = outcomes.length - sentCount;
  return {
    ok: true,
    sent: sentCount,
    failed: failedCount,
    rows: outcomes,
  };
}
