import { createServerClient } from "@/lib/supabase/server";

export interface CrossCampaignInvestor {
  investor_id: number;
  firm_name: string;
  contact_name: string | null;
  contact_title: string | null;
  entity_type: string | null;
  campaigns: CampaignEntry[];
  overlap_count: number;
  best_status: string | null;
  best_status_label: string | null;
}

export interface CampaignEntry {
  campaign_id: string;
  campaign_name: string;
  status_code: string | null;
  status_label: string | null;
  days_since: number | null;
  permission_status: string;
}

/**
 * Two-query approach — avoids deep PostgREST !inner nesting.
 * Query 1: campaign_partners + campaigns (light, no investor data)
 * Query 2: partner + investor data (separate, lighter payload)
 * Join in memory by partner_id.
 */
export async function getCrossCampaignInvestors(): Promise<CrossCampaignInvestor[]> {
  const supabase = await createServerClient();

  // Query 1: campaigns map
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!campaigns || campaigns.length === 0) return [];
  const campaignMap = new Map(campaigns.map((c) => [c.id as string, c.name as string]));

  // Query 2: campaign_partners — light, no nested joins
  const { data: cpRows } = await supabase
    .from("campaign_partners")
    .select("id, campaign_id, partner_id, status_code, status_label, last_contact_at, created_at")
    .order("created_at", { ascending: false });

  if (!cpRows || cpRows.length === 0) return [];

  // Collect unique partner_ids
  const partnerIds = [...new Set(cpRows.map((r) => r.partner_id as number))];

  // Query 3: partners + investors in two flat queries (no nesting)
  const { data: partners } = await supabase
    .from("partners_mirror")
    .select("id, investor_id, name, title")
    .in("id", partnerIds);

  const partnerMap = new Map<number, { investor_id: number; name: string | null; title: string | null }>();
  const investorIds = new Set<number>();
  for (const p of partners ?? []) {
    const row = p as { id: number; investor_id: number; name: string | null; title: string | null };
    partnerMap.set(row.id, row);
    investorIds.add(row.investor_id);
  }

  const { data: investors } = await supabase
    .from("investors_mirror")
    .select("id, firm_name, entity_type")
    .in("id", [...investorIds]);

  const investorMap = new Map<number, { firm_name: string; entity_type: string | null }>();
  for (const inv of investors ?? []) {
    const row = inv as { id: number; firm_name: string; entity_type: string | null };
    investorMap.set(row.id, row);
  }

  // Assemble — group by investor_id
  const byInvestor = new Map<number, CrossCampaignInvestor>();

  for (const cp of cpRows) {
    const partner = partnerMap.get(cp.partner_id as number);
    if (!partner) continue;
    const inv = investorMap.get(partner.investor_id);
    if (!inv) continue;

    const investorId = partner.investor_id;
    const campaignName = campaignMap.get(cp.campaign_id as string) ?? "Unknown";
    const daysSince = cp.last_contact_at
      ? Math.floor((Date.now() - new Date(cp.last_contact_at as string).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const ce: CampaignEntry = {
      campaign_id: cp.campaign_id as string,
      campaign_name: campaignName,
      status_code: cp.status_code as string | null,
      status_label: cp.status_label as string | null,
      days_since: daysSince,
      permission_status: (cp as any).permission_status ?? "not_required",
    };

    if (byInvestor.has(investorId)) {
      const existing = byInvestor.get(investorId)!;
      existing.campaigns.push(ce);
      existing.overlap_count = existing.campaigns.length;
    } else {
      byInvestor.set(investorId, {
        investor_id: investorId,
        firm_name: inv.firm_name,
        contact_name: partner.name,
        contact_title: partner.title,
        entity_type: inv.entity_type,
        campaigns: [ce],
        overlap_count: 1,
        best_status: cp.status_code as string | null,
        best_status_label: cp.status_label as string | null,
      });
    }
  }

  // Compute best status per investor
  for (const inv of byInvestor.values()) {
    const sorted = [...inv.campaigns].sort((a, b) => {
      const aNum = parseInt(a.status_code?.replace(/[^0-9-]/g, "") ?? "0", 10);
      const bNum = parseInt(b.status_code?.replace(/[^0-9-]/g, "") ?? "0", 10);
      return bNum - aNum;
    });
    inv.best_status = sorted[0]?.status_code ?? null;
    inv.best_status_label = sorted[0]?.status_label ?? null;
  }

  return Array.from(byInvestor.values()).sort((a, b) => {
    if (b.overlap_count !== a.overlap_count) return b.overlap_count - a.overlap_count;
    return a.firm_name.localeCompare(b.firm_name);
  });
}
