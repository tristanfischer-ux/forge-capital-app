"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";
import type {
  BulkActionResult,
  MarkInactiveResult,
} from "./actions-types";

/**
 * Server actions for the verification gate (§7 of V4).
 *
 * Two flows wired here:
 *   - `queueHunterForPartners`  — bulk-enqueue partners into
 *                                 `partner_email_hunt_requests` so the
 *                                 nightly Forge Capital pipeline picks
 *                                 them up. Used by the "Hunt for
 *                                 replacement" button on the
 *                                 generic-inbox tier row.
 *   - `markPartnerInactive`     — set one `campaign_partners` row to
 *                                 `-3 Disqualified` + log a
 *                                 `marked_inactive` contact_event.
 *                                 Wired to the "Mark inactive" button on
 *                                 the bounced tier row (one partner per
 *                                 call; the UI iterates).
 *
 * Auth: both actions require a signed-in user. RLS on the tables caps
 * what they can write — they can only touch their own rows.
 */

/**
 * Queue Hunter lookups for N partners in one go. Partners already in a
 * `pending` hunt request are skipped (the pipeline will pick them up on
 * its own schedule). Writes go to `partner_email_hunt_requests` — one
 * row per partner with the same note.
 *
 * Returns `processed` (new rows inserted) + `skipped` (already-pending).
 */
export async function queueHunterForPartners(input: {
  partnerIds: number[];
  notes?: string | null;
}): Promise<BulkActionResult> {
  if (!input.partnerIds || input.partnerIds.length === 0) {
    return { ok: false, error: "No partners supplied" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Skip any partner that already has a pending request — the pipeline
  // will consume them on the next run regardless.
  const { data: existing, error: existingErr } = await supabase
    .from("partner_email_hunt_requests")
    .select("partner_id, status")
    .in("partner_id", input.partnerIds)
    .eq("status", "pending");

  if (existingErr) return { ok: false, error: existingErr.message };

  const alreadyPending = new Set(
    ((existing ?? []) as Array<{ partner_id: number }>).map((r) => r.partner_id),
  );

  const fresh = input.partnerIds.filter((id) => !alreadyPending.has(id));
  if (fresh.length === 0) {
    return { ok: true, processed: 0, skipped: alreadyPending.size };
  }

  const note = input.notes?.trim() || null;
  const rows = fresh.map((partner_id) => ({
    partner_id,
    requested_by: user.id,
    notes: note,
  }));

  const { error: insertErr } = await supabase
    .from("partner_email_hunt_requests")
    .insert(rows);
  if (insertErr) return { ok: false, error: insertErr.message };

  // Deliberately NOT revalidating /verification — the gate renders
  // tier counts from `partners_mirror.email_tier`, which doesn't flip
  // when a hunt request is queued. A revalidate here would tear down
  // the React tree and lose the "N queued" toast before the founder
  // reads it. /match still revalidates so the FindAMatch drill-down
  // shows the new queued status per partner.
  revalidatePath("/match");

  return {
    ok: true,
    processed: fresh.length,
    skipped: alreadyPending.size,
  };
}

/**
 * Mark a single campaign_partner row as inactive — set `status_code =
 * '-3'` (Disqualified, per the 16-code taxonomy) and write a
 * `marked_inactive` contact_event for audit. Used by the bounced-tier
 * "Mark inactive" button on the verification gate; the caller iterates
 * for bulk cases.
 *
 * This removes the partner from the drafting pool (no status code in
 * `{-1, -2, -3}` is eligible for +1 → +2 advancement). Reversible via
 * the tracker drawer — setting the row back to a positive status code
 * re-enables drafting on the next pass.
 */
export async function markPartnerInactive(
  campaignPartnerId: string,
): Promise<MarkInactiveResult> {
  if (!campaignPartnerId) {
    return { ok: false, error: "campaignPartnerId required" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update({
      status_code: "-3",
      status_label: labelFor("-3"),
    })
    .eq("id", campaignPartnerId);
  if (updateErr) return { ok: false, error: updateErr.message };

  const { error: eventErr } = await supabase.from("contact_events").insert({
    campaign_partner_id: campaignPartnerId,
    direction: "manual",
    channel: "manual",
    event_type: "marked_inactive",
    event_at: nowIso,
    summary:
      "Partner marked inactive from the verification gate — email tier unrecoverable. Reversible via tracker drawer.",
  });
  if (eventErr) return { ok: false, error: eventErr.message };

  // Same rationale as `queueHunterForPartners` — the gate counts are
  // derived from `email_tier`, not `status_code`, so the bounced-tier
  // count doesn't change when we flip the status. Tracker revalidates
  // so the row shows the new status_code immediately.
  revalidatePath("/tracker");
  return { ok: true, processed: 1 };
}

/**
 * Convenience: mark every campaign_partner id in the list inactive in
 * parallel. Returns the total processed across the batch; on any error
 * the partial count is included in the returned message so the UI can
 * surface "3 of 4 done — one failed with <reason>".
 */
export async function markPartnersInactive(
  campaignPartnerIds: string[],
): Promise<BulkActionResult> {
  if (!campaignPartnerIds || campaignPartnerIds.length === 0) {
    return { ok: false, error: "No campaign_partner rows supplied" };
  }

  let processed = 0;
  let firstError: string | null = null;
  for (const id of campaignPartnerIds) {
    const out = await markPartnerInactive(id);
    if (out.ok) {
      processed += out.processed;
    } else if (!firstError) {
      firstError = out.error;
    }
  }

  if (firstError && processed === 0) {
    return { ok: false, error: firstError };
  }

  return {
    ok: true,
    processed,
    skipped: campaignPartnerIds.length - processed,
  };
}
