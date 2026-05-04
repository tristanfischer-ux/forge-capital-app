"use server";

import { createServerClient } from "@/lib/supabase/server";

/**
 * Bulk-insert the top N scored investors into a campaign as pending
 * approval. Bridges Discovery (truth DB) → Pipeline (personal DB).
 *
 * For each investor ID we look up the primary contact in partners_mirror
 * (falling back to the first partner if none is marked primary). We
 * skip investors that are already in the campaign (by partner_id) to
 * avoid duplicates — there is no unique constraint on campaign_partners
 * so we filter in code.
 */
export async function addMatchesToCampaign({
  campaignId,
  investorIds,
}: {
  campaignId: string;
  investorIds: number[];
}): Promise<{ added: number; skipped: number; total: number }> {
  if (!campaignId || investorIds.length === 0) {
    return { added: 0, skipped: 0, total: 0 };
  }

  const supabase = await createServerClient();

  // 1. Look up primary contacts for each investor
  const { data: partners } = await supabase
    .from("partners_mirror")
    .select("id, investor_id, is_primary_contact")
    .in("investor_id", investorIds)
    .order("is_primary_contact", { ascending: false })
    .order("id", { ascending: true });

  if (!partners || partners.length === 0) {
    return { added: 0, skipped: 0, total: investorIds.length };
  }

  // Pick one partner per investor — primary first, else first by id
  const partnerByInvestor = new Map<number, number>();
  for (const p of partners) {
    const invId = p.investor_id as number;
    if (!partnerByInvestor.has(invId)) {
      partnerByInvestor.set(invId, p.id as number);
    }
  }

  const partnerIds = Array.from(partnerByInvestor.values());

  // 2. Check which partners are already in this campaign
  const { data: existing } = await supabase
    .from("campaign_partners")
    .select("partner_id")
    .eq("campaign_id", campaignId)
    .in("partner_id", partnerIds);

  const existingSet = new Set(
    (existing ?? []).map((r) => (r as { partner_id: number }).partner_id),
  );

  // 3. Build insert rows for partners not already in campaign
  const toInsert = partnerIds
    .filter((pid) => !existingSet.has(pid))
    .map((pid) => ({
      campaign_id: campaignId,
      partner_id: pid,
      status_code: "+0",
      status_label: "Pending approval",
    }));

  if (toInsert.length === 0) {
    return { added: 0, skipped: partnerIds.length, total: investorIds.length };
  }

  // 4. Bulk insert in batches of 500
  let added = 0;
  const BATCH = 500;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("campaign_partners")
      .insert(batch, { count: "exact" });

    if (error) {
      console.error("addMatchesToCampaign insert error:", error.message);
    } else {
      added += count ?? batch.length;
    }
  }

  // Sync cross-campaign outreach state so warnings are fresh
  if (added > 0) {
    try {
      await supabase.rpc("sync_investor_outreach_state");
    } catch {
      // Non-critical — state will sync on next call
    }
  }

  return {
    added,
    skipped: existingSet.size,
    total: investorIds.length,
  };
}

/**
 * Create a new campaign with the given name and intent.
 * Returns the new campaign ID on success.
 */
export async function createCampaign({
  name,
  intent,
}: {
  name: string;
  intent: "investor" | "customer" | "supplier";
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!name.trim()) return { ok: false, error: "Campaign name is required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      name: slug,
      display_name: name.trim(),
      campaign_intent: intent,
      status: "active",
      week_started_at: new Date().toISOString(),
      week_count_target: 16,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createCampaign failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}
