"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Swap the contact (partners_mirror row) that a campaign_partners row
 * points at. Used by the ContactPicker on /approval + /tracker drawer
 * so Tristan can pick who at the firm he actually wants to email
 * (IKEA's plant-category buyer vs. sustainability lead, the Quebec
 * grower's president vs. operations manager, etc.).
 *
 * Per Tristan's 2026-04-24 direction: swap regenerates from scratch.
 * We clear the cached rendered_synthesis + subject_angle so the
 * composer re-writes the bio-paragraph + opener for the new person.
 *
 * We also cancel any pending scheduled_sends tied to the row — the
 * queued body was addressed to the old contact and shipping it now
 * would be a cross-contact rule violation. Cancellation is soft: the
 * scheduled_sends row gets status='cancelled' + an error_message
 * explaining why, never a hard delete (so the founder can see in the
 * /approval/scheduled monitor that the send was cancelled due to a
 * contact swap, not lost to a bug).
 *
 * The polymorphic-partners CHECK (migration 030) guarantees the new
 * partner_id references the same kind of org as the old one (either
 * both investor-kind or both customer-kind) — we enforce that
 * defensively in this action too so a client bug can't cross-wire an
 * investor partner_id onto a customer campaign_partners row.
 *
 * Returns { ok: true } on success, { ok: false, error } on any failure.
 * Revalidates /approval + /tracker so the UI reflects the swap on the
 * next render without a full page reload.
 */

export interface SwitchContactInput {
  campaignPartnerId: string;
  newPartnerId: number;
}

export type SwitchContactResult =
  | { ok: true; cancelledScheduledSends: number }
  | { ok: false; error: string };

export async function switchContact(
  input: SwitchContactInput,
): Promise<SwitchContactResult> {
  const { campaignPartnerId, newPartnerId } = input;

  if (!campaignPartnerId) {
    return { ok: false, error: "campaignPartnerId is required." };
  }
  if (!Number.isFinite(newPartnerId) || newPartnerId <= 0) {
    return { ok: false, error: "newPartnerId must be a positive integer." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Load current campaign_partners + partner_mirror so we can sanity-
  // check the kind match BEFORE touching anything.
  const { data: cpRow, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id, campaign_id, partner_id,
      partners_mirror:partner_id ( id, kind )
      `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();
  if (cpErr || !cpRow) {
    return {
      ok: false,
      error: cpErr?.message ?? "campaign_partners row not found.",
    };
  }
  const current = cpRow as unknown as {
    id: string;
    campaign_id: string;
    partner_id: number | null;
    partners_mirror: { id: number; kind: "investor" | "customer" } | null;
  };
  if (!current.partners_mirror) {
    return { ok: false, error: "current partner not linked to any org." };
  }
  if (current.partner_id === newPartnerId) {
    return { ok: true, cancelledScheduledSends: 0 };
  }

  // Check the destination partners_mirror row exists and has matching kind.
  const { data: newPartner, error: newErr } = await supabase
    .from("partners_mirror")
    .select("id, kind, investor_id, customer_id")
    .eq("id", newPartnerId)
    .maybeSingle();
  if (newErr || !newPartner) {
    return {
      ok: false,
      error: newErr?.message ?? "target partners_mirror row not found.",
    };
  }
  if (newPartner.kind !== current.partners_mirror.kind) {
    return {
      ok: false,
      error: `Kind mismatch: current is ${current.partners_mirror.kind}, new is ${newPartner.kind}. Swap refused.`,
    };
  }

  // Swap the pointer + clear the cached draft so the composer
  // regenerates the bio/opener/synthesis for the new person.
  const { error: updateErr } = await supabase
    .from("campaign_partners")
    .update({
      partner_id: newPartnerId,
      rendered_synthesis: null,
      subject_angle: null,
    })
    .eq("id", campaignPartnerId);
  if (updateErr) {
    return { ok: false, error: `Update failed: ${updateErr.message}` };
  }

  // Cancel any pending scheduled_sends that referenced the old contact.
  // We only touch rows with status='pending' — in-flight / already-sent
  // rows are immutable (their history is the audit trail).
  const { data: toCancel, error: cancelFetchErr } = await supabase
    .from("scheduled_sends")
    .select("id")
    .eq("campaign_partner_id", campaignPartnerId)
    .eq("status", "pending");
  if (cancelFetchErr) {
    return {
      ok: false,
      error: `Pending scheduled_sends fetch failed: ${cancelFetchErr.message}`,
    };
  }
  let cancelledCount = 0;
  if (toCancel && toCancel.length > 0) {
    const { error: cancelErr } = await supabase
      .from("scheduled_sends")
      .update({
        status: "cancelled",
        error_message:
          "Cancelled — contact swapped via ContactPicker. The queued body was addressed to the previous contact; a new scheduled send for the new contact can be queued via /approval.",
      })
      .eq("campaign_partner_id", campaignPartnerId)
      .eq("status", "pending");
    if (cancelErr) {
      return {
        ok: false,
        error: `Pending scheduled_sends cancel failed: ${cancelErr.message}`,
      };
    }
    cancelledCount = toCancel.length;
  }

  // Revalidate the surfaces that read campaign_partners.partner_id.
  revalidatePath("/approval");
  revalidatePath("/tracker");
  revalidatePath(`/tracker/${campaignPartnerId}/draft`);

  return { ok: true, cancelledScheduledSends: cancelledCount };
}
