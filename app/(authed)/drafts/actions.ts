"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Drafts page — inline edit + discard server actions.
 *
 * Per the global MEMORY.md gotcha, `"use server"` files can ONLY export
 * async functions.
 *
 * APPROVAL GATE — critical rule (forge-capital-app CLAUDE.md):
 * These actions only modify draft metadata (subject/body overrides and
 * discard flag). They NEVER bypass the approval gate — the partner must
 * already be at +2 Drafted for these actions to apply. The discard
 * action moves the partner BACK to +1 (approved, awaiting draft), which
 * is the correct state when a draft is abandoned.
 */

export type SaveDraftResult =
  | { ok: true }
  | { ok: false; error: string };

export type DiscardDraftResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server action: save inline edits to subject and body for a +2 Drafted
 * campaign partner.
 *
 * Writes to `campaign_partners.draft_subject_override` and
 * `campaign_partners.draft_body_override` (added in migration 034).
 * The drafts panel reads these columns and prefers them over the
 * composed values when non-null.
 */
export async function saveDraftEdits(input: {
  campaignPartnerId: string;
  subject: string;
  body: string;
}): Promise<SaveDraftResult> {
  const { campaignPartnerId, subject, body } = input;
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId is required." };
  if (!subject.trim()) return { ok: false, error: "Subject cannot be empty." };
  if (!body.trim()) return { ok: false, error: "Body cannot be empty." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Verify the partner exists at +2.
  const { data: cp, error: readErr } = await supabase
    .from("campaign_partners")
    .select("id, status_code")
    .eq("id", campaignPartnerId)
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: `Partner read failed: ${readErr.message}` };
  }
  if (!cp) {
    return { ok: false, error: "Partner not found or not accessible." };
  }
  const cpRow = cp as { id: string; status_code: string };
  if (cpRow.status_code !== "+2") {
    return {
      ok: false,
      error: `Draft edits only apply to +2 Drafted partners (this partner is at ${cpRow.status_code}).`,
    };
  }

  const { error: updErr } = await supabase
    .from("campaign_partners")
    .update({
      draft_subject_override: subject.trim(),
      draft_body_override: body.trim(),
    })
    .eq("id", campaignPartnerId);

  if (updErr) {
    return { ok: false, error: `Draft save failed: ${updErr.message}` };
  }

  revalidatePath("/drafts");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Server action: discard a +2 Drafted campaign partner's draft.
 *
 * Two effects:
 *   1. Sets `draft_discarded_at = now()` so the record is flagged.
 *   2. Moves `status_code` back to `+1` (Approved — awaiting draft).
 *      This preserves the approval decision; the draft just needs to be redone.
 *
 * Gmail: any pending scheduled_sends rows are cancelled (best-effort).
 * Gmail-side draft deletion is V2 — the confirmation dialog explains this
 * to the founder.
 */
export async function discardDraft(input: {
  campaignPartnerId: string;
}): Promise<DiscardDraftResult> {
  const { campaignPartnerId } = input;
  if (!campaignPartnerId) return { ok: false, error: "campaignPartnerId is required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Verify the partner is at +2 before discarding.
  const { data: cp, error: readErr } = await supabase
    .from("campaign_partners")
    .select("id, status_code")
    .eq("id", campaignPartnerId)
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: `Partner read failed: ${readErr.message}` };
  }
  if (!cp) {
    return { ok: false, error: "Partner not found or not accessible." };
  }
  const cpRow = cp as { id: string; status_code: string };
  if (cpRow.status_code !== "+2") {
    return {
      ok: false,
      error: `Discard only applies to +2 Drafted partners (this partner is at ${cpRow.status_code}).`,
    };
  }

  // Cancel any pending scheduled_sends rows — best-effort, don't fail on error.
  await supabase
    .from("scheduled_sends")
    .update({ status: "cancelled" })
    .eq("campaign_partner_id", campaignPartnerId)
    .eq("status", "pending");

  // Move partner back to +1 and stamp the discard timestamp.
  const { error: updErr } = await supabase
    .from("campaign_partners")
    .update({
      status_code: "+1",
      status_label: "Approved — awaiting draft",
      draft_discarded_at: new Date().toISOString(),
      // Clear overrides so a fresh draft starts clean.
      draft_subject_override: null,
      draft_body_override: null,
    })
    .eq("id", campaignPartnerId);

  if (updErr) {
    return { ok: false, error: `Discard failed: ${updErr.message}` };
  }

  // TODO (V2): call Gmail Drafts.delete API if gmail_draft_id is set on
  // the scheduled_sends row — for now the confirmation dialog tells the
  // founder to delete the Gmail draft manually.

  revalidatePath("/drafts");
  revalidatePath("/home");
  revalidatePath("/tracker");
  return { ok: true };
}
