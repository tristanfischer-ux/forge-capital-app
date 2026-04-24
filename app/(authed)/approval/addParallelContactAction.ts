"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Tier 3 — parallel outreach. Create a NEW campaign_partners row for
 * an additional contact at the same organisation already on the
 * campaign, instead of swapping the existing row's partner_id.
 *
 * Use case Tristan flagged 2026-04-24: IKEA has 15 contacts; reaching
 * out to the Plant-category Buyer AND the Sustainability Lead in
 * parallel is sometimes the right play (two angles, two replies to
 * learn from). With only Tier 1+2 (the swap path), parallel threads
 * were impossible — the row could only point at one contact at a time.
 *
 * Schema already supports this: campaign_partners has a
 * UNIQUE(campaign_id, partner_id) constraint, so N contacts at the
 * same firm each get their own row naturally.
 *
 * Returns { ok, created: { campaign_partner_id }, existingThreads }
 * where existingThreads is the count of other active rows for the same
 * firm. The caller uses it to decide whether to surface a soft "you
 * already have N active threads at <firm>" warning.
 *
 * HARD RULE (Tristan 2026-04-24): new row is created at +0 Pending
 * approval. The DB trigger from migration 029 guarantees it can't
 * leak into scheduled_sends before the founder promotes it to +1.
 */

export interface AddParallelContactInput {
  /** The existing row we're branching from — gives us campaign_id +
   *  kind + firm_id so we don't need them as separate params. */
  sourceCampaignPartnerId: string;
  /** The partners_mirror row for the NEW contact at the same firm. */
  newPartnerId: number;
}

export type AddParallelContactResult =
  | {
      ok: true;
      created_campaign_partner_id: string;
      existing_active_threads: number;
    }
  | { ok: false; error: string };

/**
 * Active status codes — anything that represents a live outreach
 * thread, excluding terminal states (disqualified / bounced /
 * declined). Used to count "threads already in flight at this firm"
 * so the caller can show a soft warning.
 */
const ACTIVE_STATUS_CODES = [
  "+0", "+1", "+2", "+3", "+4", "+5", "+6", "+6.5", "+7", "+8", "+9",
  "+10", "+11", "+12",
];

export async function addParallelContact(
  input: AddParallelContactInput,
): Promise<AddParallelContactResult> {
  const { sourceCampaignPartnerId, newPartnerId } = input;
  if (!sourceCampaignPartnerId) {
    return { ok: false, error: "sourceCampaignPartnerId is required." };
  }
  if (!Number.isFinite(newPartnerId) || newPartnerId <= 0) {
    return { ok: false, error: "newPartnerId must be a positive integer." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Load the source row to get campaign_id + kind + firm id.
  const { data: sourceRow, error: sourceErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id, campaign_id, partner_id,
      partners_mirror:partner_id (
        kind, investor_id, customer_id
      )
      `,
    )
    .eq("id", sourceCampaignPartnerId)
    .maybeSingle();
  if (sourceErr || !sourceRow) {
    return {
      ok: false,
      error: sourceErr?.message ?? "Source campaign_partners row not found.",
    };
  }
  const source = sourceRow as unknown as {
    id: string;
    campaign_id: string;
    partner_id: number | null;
    partners_mirror: {
      kind: "investor" | "customer";
      investor_id: number | null;
      customer_id: number | null;
    } | null;
  };
  if (!source.partners_mirror || !source.campaign_id) {
    return { ok: false, error: "Source row is missing partner or campaign link." };
  }
  const sourceKind = source.partners_mirror.kind;
  const sourceFirmId =
    sourceKind === "investor"
      ? source.partners_mirror.investor_id
      : source.partners_mirror.customer_id;
  if (!sourceFirmId) {
    return { ok: false, error: "Source partner has no org link." };
  }

  // Verify the new partners_mirror row exists, shares kind, and points
  // at the same org. Cross-kind OR cross-firm adds are refused — if
  // Tristan wants to reach out to someone at a DIFFERENT firm, that's
  // a new shortlist, not a parallel thread.
  const { data: newPartner, error: newErr } = await supabase
    .from("partners_mirror")
    .select("id, kind, investor_id, customer_id")
    .eq("id", newPartnerId)
    .maybeSingle();
  if (newErr || !newPartner) {
    return {
      ok: false,
      error: newErr?.message ?? "New partners_mirror row not found.",
    };
  }
  if (newPartner.kind !== sourceKind) {
    return {
      ok: false,
      error: `Kind mismatch: source is ${sourceKind}, new is ${newPartner.kind}. Parallel threads must be at the same org.`,
    };
  }
  const newFirmId =
    newPartner.kind === "investor"
      ? newPartner.investor_id
      : newPartner.customer_id;
  if (newFirmId !== sourceFirmId) {
    return {
      ok: false,
      error: `Firm mismatch: parallel threads must target the same org as the source row. Shortlist a separate firm via Find-a-Match instead.`,
    };
  }

  // Refuse if a row for (campaign_id, newPartnerId) already exists.
  // The UNIQUE constraint would error anyway, but we return a clean
  // message instead of "duplicate key".
  const { data: existing, error: existingErr } = await supabase
    .from("campaign_partners")
    .select("id, status_code")
    .eq("campaign_id", source.campaign_id)
    .eq("partner_id", newPartnerId)
    .maybeSingle();
  if (existingErr) {
    return {
      ok: false,
      error: `Duplicate check failed: ${existingErr.message}`,
    };
  }
  if (existing) {
    return {
      ok: false,
      error: `That contact is already on this campaign (status ${existing.status_code ?? "unknown"}). Swap the existing row instead of duplicating it.`,
    };
  }

  // Count other active threads at the same firm — surfaces in the
  // UI as a soft "you already have N active threads at <firm>"
  // warning.
  const { data: siblingPartnerIds } = await supabase
    .from("partners_mirror")
    .select("id")
    .eq("kind", sourceKind)
    .eq(sourceKind === "investor" ? "investor_id" : "customer_id", sourceFirmId);
  const siblingIds = ((siblingPartnerIds ?? []) as Array<{ id: number }>).map(
    (r) => r.id,
  );
  let existingActiveThreads = 0;
  if (siblingIds.length > 0) {
    const { count } = await supabase
      .from("campaign_partners")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", source.campaign_id)
      .in("partner_id", siblingIds)
      .in("status_code", ACTIVE_STATUS_CODES);
    existingActiveThreads = count ?? 0;
  }

  // Insert the new row at +0 Pending approval.
  const { data: created, error: insertErr } = await supabase
    .from("campaign_partners")
    .insert({
      campaign_id: source.campaign_id,
      partner_id: newPartnerId,
      status_code: "+0",
      status_label: "Pending approval",
    })
    .select("id")
    .single();
  if (insertErr || !created) {
    return {
      ok: false,
      error: `Insert failed: ${insertErr?.message ?? "unknown error"}`,
    };
  }

  revalidatePath("/approval");
  revalidatePath("/tracker");

  return {
    ok: true,
    created_campaign_partner_id: created.id,
    existing_active_threads: existingActiveThreads,
  };
}
