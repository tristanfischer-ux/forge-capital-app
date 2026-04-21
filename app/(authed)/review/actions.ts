"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";

/**
 * Server action: accept a draft for send.
 *
 * V4 §5 semantics (Phase2-Mockup-V4.html line 1538 "Enter accept → send
 * from Gmail"). V1 doesn't send from Gmail — Gmail stays authoritative —
 * so "accept" here records the advance to `+3 Email sent` and writes an
 * outbound contact_event. Tristan is expected to have copied the draft
 * into Gmail and clicked send; this action captures that decision.
 */
export async function acceptDraft(
  campaignPartnerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update({
      status_code: "+3",
      status_label: labelFor("+3"),
      last_contact_at: nowIso,
    })
    .eq("id", campaignPartnerId)
    // Guard: only permit the accept transition from +2 so stale tabs
    // cannot roll a +6 Response received back to +3.
    .eq("status_code", "+2");
  if (updateErr) return { ok: false, error: updateErr.message };

  const { error: eventErr } = await supabase.from("contact_events").insert({
    campaign_partner_id: campaignPartnerId,
    direction: "outbound",
    channel: "gmail",
    event_type: "sent",
    event_at: nowIso,
    summary: "Draft accepted in review stack — marked +3 Email sent.",
  });
  if (eventErr) return { ok: false, error: eventErr.message };

  revalidatePath("/review");
  revalidatePath("/tracker");
  return { ok: true };
}

/**
 * Server action: discard a draft.
 *
 * V4 §5 semantics (line 1540 "D discard + log reason"). Discard means the
 * DRAFT is bad — not the partner. The partner reverts to `+1 Approved —
 * awaiting draft` so the next generation pass picks them up again. We do
 * NOT move them to -3 Disqualified — that would penalise the partner for a
 * copy failure (per V4 line 1644, the flagged draft #3 would have sent
 * forbidden copy; discarding should regenerate, not disqualify).
 */
export async function discardDraft(
  campaignPartnerId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();
  const trimmedReason = (reason ?? "").trim();

  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update({
      status_code: "+1",
      status_label: labelFor("+1"),
      // Deliberately NOT updating last_contact_at — a discarded draft was
      // never actually contacted.
    })
    .eq("id", campaignPartnerId)
    .eq("status_code", "+2");
  if (updateErr) return { ok: false, error: updateErr.message };

  const summary = trimmedReason
    ? `Draft discarded in review stack — ${trimmedReason}. Reverted to +1 Approved.`
    : "Draft discarded in review stack — reverted to +1 Approved (regenerate).";

  const { error: eventErr } = await supabase.from("contact_events").insert({
    campaign_partner_id: campaignPartnerId,
    direction: "manual",
    channel: "manual",
    event_type: "manual_note",
    event_at: nowIso,
    summary,
  });
  if (eventErr) return { ok: false, error: eventErr.message };

  revalidatePath("/review");
  revalidatePath("/tracker");
  return { ok: true };
}
