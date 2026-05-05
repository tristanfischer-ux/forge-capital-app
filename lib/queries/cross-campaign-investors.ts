import { createServerClient } from "@/lib/supabase/server";

export interface CrossCampaignInvestor {
  investor_id: number;
  firm_name: string;
  contact_name: string | null;
  contact_title: string | null;
  entity_type: string | null;
  sector: string | null;
  website: string | null;
  hq_location: string | null;
  thesis_summary: string | null;
  campaigns: CampaignStatus[];
  overlap_count: number;
  best_status: string | null;
  best_status_label: string | null;
  last_contact: string | null;
}

export interface CampaignStatus {
  campaign_id: string;
  campaign_name: string;
  status_code: string | null;
  status_label: string | null;
  days_since: number | null;
  last_contact_at: string | null;
  permission_status: string;
}

/**
 * Cross-campaign investor rollup — the web equivalent of Master Investor Tracker.
 * Returns every investor Tristan has ever reached out to, with per-campaign status.
 */
export async function getCrossCampaignInvestors(): Promise<CrossCampaignInvestor[]> {
  const supabase = await createServerClient();

  // Get all campaigns
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!campaigns || campaigns.length === 0) return [];

  // Get all campaign_partners with investor + partner data
  const { data: partners } = await supabase
    .from("campaign_partners")
    .select(`
      id,
      campaign_id,
      partner_id,
      status_code,
      status_label,
      last_contact_at,
      created_at,
      partners_mirror!inner (
        id,
        investor_id,
        name,
        title,
        email,
        focus_areas,
        bio,
        investors_mirror!inner (
          id,
          firm_name,
          type,
          website,
          hq_location,
          thesis_summary,
          entity_type,
          sector_focus
        )
      )
    `)
    .order("created_at", { ascending: false });

  if (!partners) return [];

  // Group by investor_id
  const byInvestor = new Map<number, CrossCampaignInvestor>();

  for (const row of partners) {
    const investorId = (row.partners_mirror as any)?.investors_mirror?.id;
    if (!investorId) continue;

    const firmName = (row.partners_mirror as any)?.investors_mirror?.firm_name ?? "Unknown";
    const contactName = (row.partners_mirror as any)?.name ?? null;
    const contactTitle = (row.partners_mirror as any)?.title ?? null;
    const entityType = (row.partners_mirror as any)?.investors_mirror?.entity_type ?? null;
    const sector = (row.partners_mirror as any)?.investors_mirror?.sector_focus ?? null;
    const website = (row.partners_mirror as any)?.investors_mirror?.website ?? null;
    const hqLocation = (row.partners_mirror as any)?.investors_mirror?.hq_location ?? null;
    const thesisSummary = (row.partners_mirror as any)?.investors_mirror?.thesis_summary ?? null;

    const campaign = campaigns.find((c) => c.id === row.campaign_id);
    const daysSince = row.last_contact_at
      ? Math.floor((Date.now() - new Date(row.last_contact_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const cs: CampaignStatus = {
      campaign_id: row.campaign_id,
      campaign_name: campaign?.name ?? "Unknown",
      status_code: row.status_code,
      status_label: row.status_label,
      days_since: daysSince,
      last_contact_at: row.last_contact_at,
      permission_status: "not_required", // Column may not exist yet — run migration SQL to enable
    };

    if (byInvestor.has(investorId)) {
      const existing = byInvestor.get(investorId)!;
      existing.campaigns.push(cs);
      existing.overlap_count = existing.campaigns.length;
    } else {
      byInvestor.set(investorId, {
        investor_id: investorId,
        firm_name: firmName,
        contact_name: contactName,
        contact_title: contactTitle,
        entity_type: entityType,
        sector: sector,
        website: website,
        hq_location: hqLocation,
        thesis_summary: thesisSummary,
        campaigns: [cs],
        overlap_count: 1,
        best_status: row.status_code,
        best_status_label: row.status_label,
        last_contact: row.last_contact_at,
      });
    }
  }

  // Compute best status for each investor
  for (const inv of byInvestor.values()) {
    // Sort campaigns by status_code numerically (higher = better)
    const sorted = [...inv.campaigns].sort((a, b) => {
      const aNum = parseInt(a.status_code?.replace(/[^0-9-]/g, "") ?? "0", 10);
      const bNum = parseInt(b.status_code?.replace(/[^0-9-]/g, "") ?? "0", 10);
      return bNum - aNum;
    });
    inv.best_status = sorted[0]?.status_code ?? null;
    inv.best_status_label = sorted[0]?.status_label ?? null;
    inv.last_contact = sorted[0]?.last_contact_at ?? null;
  }

  return Array.from(byInvestor.values()).sort((a, b) => {
    // Sort by overlap count desc, then firm name
    if (b.overlap_count !== a.overlap_count) return b.overlap_count - a.overlap_count;
    return a.firm_name.localeCompare(b.firm_name);
  });
}
