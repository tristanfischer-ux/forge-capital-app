"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getInvestorModalData } from "@/lib/queries/investorModal";
import { composeDraft } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/compose";
import { refineSynthesisWithOpus } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/refineSynthesisAction";
import {
  timezoneForLocation,
  localToUtc,
} from "@/lib/email/partner-timezone";

/**
 * Server action: queue a batch of scheduled sends.
 *
 * Takes the first N `+0` pending-approval rows for the campaign, runs
 * each through the same composer + Opus-refinement pipeline as the
 * test-send path, resolves each partner's timezone from their HQ
 * string, and computes a jittered local-window UTC timestamp. One
 * row is written to `scheduled_sends` per partner. The dispatcher
 * daemon (scripts/scheduled-sends-dispatcher.mjs) polls and sends.
 *
 * Note on Hunter API key fallback:
 *   If `HUNTER_API_KEY` is not set, the `sendGmailMessage` pre-flight
 *   falls back to an MX-only check. The dispatcher handles that at
 *   send time; this action just queues the rows. No Hunter calls
 *   happen during queueing — composeDraft + DB insert only.
 *
 * Design doc: docs/design-scheduled-sends.md.
 */

export interface QueueScheduledBatchInput {
  campaignId: string;
  maxCount: number;
  windowLocalStartHour: number; // 0-23
  windowLocalEndHour: number; // 0-23, exclusive
  targetDate: string; // ISO date yyyy-mm-dd (local wall-clock of the partner's tz)
}

export interface QueuedRowSummary {
  partnerId: string;
  firmName: string | null;
  tz: string;
  /** ISO UTC timestamp of the planned send, or null on skip. */
  scheduledForUtc: string | null;
  ok: boolean;
  reason?: string;
}

export type QueueScheduledBatchResult =
  | {
      ok: true;
      queuedCount: number;
      skippedCount: number;
      rows: QueuedRowSummary[];
    }
  | { ok: false; error: string };

export async function queueScheduledBatch(
  input: QueueScheduledBatchInput,
): Promise<QueueScheduledBatchResult> {
  const {
    campaignId,
    maxCount,
    windowLocalStartHour,
    windowLocalEndHour,
    targetDate,
  } = input;

  if (!campaignId) return { ok: false, error: "campaignId is required." };
  if (
    !Number.isFinite(windowLocalStartHour) ||
    !Number.isFinite(windowLocalEndHour) ||
    windowLocalStartHour < 0 ||
    windowLocalStartHour > 23 ||
    windowLocalEndHour < 1 ||
    windowLocalEndHour > 24 ||
    windowLocalEndHour <= windowLocalStartHour
  ) {
    return {
      ok: false,
      error:
        "Local-hour window must be 0-24 with start < end (e.g. 6 → 7).",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return {
      ok: false,
      error: "targetDate must be ISO yyyy-mm-dd.",
    };
  }
  const [y, m, d] = targetDate.split("-").map(Number);
  if (!y || !m || !d) {
    return { ok: false, error: "targetDate could not be parsed." };
  }
  const capped = Math.max(1, Math.min(50, Math.floor(maxCount)));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // HARD RULE (Tristan 2026-04-24): "there is no permission to
  // automatically send things until they have been approved. That has
  // to be a very fast rule that cannot be broken." Rows must sit at
  // +1 (Approved — awaiting draft) or +2 (Drafted — ready to send)
  // before they can be queued. +0 (Pending approval) is explicitly
  // ineligible and older code paths that queued +0 rows have been
  // closed.
  const { data: pending, error: pendingErr } = await supabase
    .from("campaign_partners")
    .select("id, status_code")
    .eq("campaign_id", campaignId)
    .in("status_code", ["+1", "+2"])
    .order("created_at", { ascending: true })
    .limit(capped + 10);

  if (pendingErr) {
    return {
      ok: false,
      error: `Approved-rows read failed: ${pendingErr.message}`,
    };
  }

  const pendingIds = (pending ?? []).map((r) => r.id as string);
  if (pendingIds.length === 0) {
    return {
      ok: false,
      error:
        "No approved rows on this campaign. Rows must be at +1 (Approved — awaiting draft) or +2 (Drafted — ready to send) before they can be scheduled. Ingest approval decisions on /approval first.",
    };
  }

  const rows: QueuedRowSummary[] = [];
  let queuedCount = 0;

  for (const partnerId of pendingIds) {
    if (queuedCount >= capped) break;

    // Load partner data.
    let data = await getInvestorModalData(partnerId);
    if (!data) {
      rows.push({
        partnerId,
        firmName: null,
        tz: "UTC",
        scheduledForUtc: null,
        ok: false,
        reason: "getInvestorModalData returned null",
      });
      continue;
    }
    const firmName = data.investor.firm_name ?? "Unknown firm";
    const partnerEmail = data.primary_partner?.email ?? null;
    if (!partnerEmail) {
      rows.push({
        partnerId,
        firmName,
        tz: "UTC",
        scheduledForUtc: null,
        ok: false,
        reason: "No partner email — queue skipped",
      });
      continue;
    }

    // Ensure synthesis + subject_angle are cached (same guard as test-send).
    if (!data.rendered_synthesis || !data.subject_angle) {
      const refined = await refineSynthesisWithOpus({
        campaignPartnerId: partnerId,
      });
      if (refined.ok) {
        data = await getInvestorModalData(partnerId);
        if (!data) {
          rows.push({
            partnerId,
            firmName,
            tz: "UTC",
            scheduledForUtc: null,
            ok: false,
            reason: "reload after refine returned null",
          });
          continue;
        }
      } else {
        rows.push({
          partnerId,
          firmName,
          tz: "UTC",
          scheduledForUtc: null,
          ok: false,
          reason: `Synthesis could not be generated: ${refined.error}`,
        });
        continue;
      }
    }

    const draft = composeDraft(data);

    // Resolve partner's timezone from hq_location.
    const hq = data.investor.hq_location;
    const tz = timezoneForLocation(hq);

    // Jitter a random time within the window. For UTC-fallback rows we
    // use the same window but applied to UTC wall-clock — documented in
    // the UI so the founder can decide to refine the HQ string or
    // accept the UTC fallback.
    const windowSpanMinutes =
      (windowLocalEndHour - windowLocalStartHour) * 60;
    const jitterMinutes = Math.floor(Math.random() * windowSpanMinutes);
    const localHour = windowLocalStartHour + Math.floor(jitterMinutes / 60);
    const localMinute = jitterMinutes % 60;

    const scheduledDate = localToUtc(y, m, d, localHour, localMinute, tz);
    const scheduledForUtc = scheduledDate.toISOString();

    // Compose the full body — match test-send pattern EXCEPT no [TEST]
    // prefix and no test banner. This is a real send.
    const subject = draft.subject.slice(0, 240);
    const body = draft.fullBody;

    const { error: insertErr } = await supabase
      .from("scheduled_sends")
      .insert({
        campaign_partner_id: partnerId,
        to_email: partnerEmail,
        subject,
        body,
        scheduled_for_utc: scheduledForUtc,
        status: "pending",
        created_by: user.id,
      });

    if (insertErr) {
      rows.push({
        partnerId,
        firmName,
        tz,
        scheduledForUtc: null,
        ok: false,
        reason: `scheduled_sends insert failed: ${insertErr.message}`,
      });
      continue;
    }

    rows.push({
      partnerId,
      firmName,
      tz,
      scheduledForUtc,
      ok: true,
    });
    queuedCount += 1;
  }

  revalidatePath("/approval/schedule-send");
  revalidatePath("/approval/scheduled");
  revalidatePath("/approval");

  const skippedCount = rows.length - queuedCount;
  return {
    ok: true,
    queuedCount,
    skippedCount,
    rows,
  };
}

/**
 * Cancel a pending scheduled send. No-op if already dispatching/sent —
 * the dispatcher claims rows atomically by flipping status → dispatching
 * before the Gmail call, so there's no race where a cancel lands
 * between the poll and the send.
 */
export async function cancelScheduledSend(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "id is required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("scheduled_sends")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/approval/scheduled");
  return { ok: true };
}
