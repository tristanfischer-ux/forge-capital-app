"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";

/**
 * Server action: bulk-approve a list of campaign_partner IDs.
 *
 * Sets each row to status_code='+1' (Approved — awaiting draft) and logs a
 * contact_event. Scoped to the authenticated user via RLS on the server
 * client — no service-role bypass.
 *
 * Does NOT touch scheduled_sends — approved rows still require the separate
 * "Schedule send" step. The approval gate (migration 029 trigger) blocks any
 * premature scheduled_sends insert regardless.
 */
export async function bulkApprove(input: {
  campaignPartnerIds: string[];
}): Promise<
  | { ok: true; approved: number; failed: Array<{ id: string; error: string }> }
  | { ok: false; error: string }
> {
  const { campaignPartnerIds } = input;

  if (!Array.isArray(campaignPartnerIds) || campaignPartnerIds.length === 0) {
    return { ok: false, error: "No rows selected" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const nowIso = new Date().toISOString();
  const statusCode = "+1";
  const statusLabel = labelFor(statusCode);
  let approved = 0;
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of campaignPartnerIds) {
    const { error: updateErr } = await supabase
      .from("campaign_partners")
      .update({
        status_code: statusCode,
        status_label: statusLabel,
        approved_by: user.email ?? null,
        approved_at: nowIso,
      })
      .eq("id", id);

    if (updateErr) {
      failed.push({ id, error: updateErr.message });
      continue;
    }

    // Audit trail — matches the per-row path in applyApprovalVerdicts.
    await supabase.from("contact_events").insert({
      campaign_partner_id: id,
      direction: "manual",
      channel: "manual",
      event_type: "status_update",
      event_at: nowIso,
      summary: "[bulk approve] Approved — awaiting draft",
    });

    approved += 1;
  }

  revalidatePath("/approval");
  revalidatePath("/tracker");
  return { ok: true, approved, failed };
}
