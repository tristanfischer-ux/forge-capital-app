import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier } from "@/lib/queries/tracker";

/**
 * Profile-page data loader — reads a single investor row by bare numeric id
 * from `investors_mirror` plus every partner on the firm and any
 * campaign_partners rows the current user can see (RLS-scoped). Used by
 * `/investor/[id]`. Unlike `getInvestorModalData` this is NOT bound to a
 * specific campaign_partner row — the profile is reachable by double-clicking
 * a match result before any tracker row exists.
 */

export interface InvestorProfilePartner {
  id: number;
  name: string | null;
  title: string | null;
  email: string | null;
  email_tier: EmailTier;
  linkedin: string | null;
  bio: string | null;
  focus_areas: string | null;
  is_primary_contact: boolean;
}

export interface InvestorProfileCampaignLink {
  campaign_id: string;
  campaign_name: string | null;
  partner_name: string | null;
  status_code: string | null;
  status_label: string | null;
  last_contact_at: string | null;
  days_since_last_contact: number | null;
}

export interface InvestorProfileData {
  id: number;
  firm_name: string | null;
  type: string | null;
  website: string | null;
  hq_location: string | null;
  thesis_summary: string | null;
  thesis_deep: string | null;
  stage_focus: string | null;
  sector_focus: string | null;
  geo_focus: string | null;
  cheque_min_usd: number | null;
  cheque_max_usd: number | null;
  fund_size_usd: number | null;
  actively_deploying: boolean | null;
  synthesis_confidence: string | null;
  connection_brief: string | null;
  investment_pattern: string | null;
  team_expertise: string | null;
  ideal_company_profile: string | null;
  value_add: string | null;
  recent_activity: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  data_quality_score: number | null;
  hardware_fit_score: number | null;
  last_enriched: string | null;
  portfolio_companies: string[];
  partners: InvestorProfilePartner[];
  campaign_links: InvestorProfileCampaignLink[];
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function parsePortfolioCompanies(synthesisData: unknown): string[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const bag = synthesisData as Record<string, unknown>;
  for (const key of [
    "portfolio_companies",
    "portfolio",
    "portfolio_highlights",
    "notable_investments",
  ]) {
    const value = bag[key];
    if (Array.isArray(value)) {
      const names = value
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            const rec = entry as Record<string, unknown>;
            const name = rec.name ?? rec.company ?? rec.firm ?? rec.title;
            return typeof name === "string" ? name : null;
          }
          return null;
        })
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      if (names.length > 0) return names;
    }
  }
  return [];
}

export async function getInvestorProfile(
  investorId: number,
): Promise<InvestorProfileData | null> {
  if (!Number.isFinite(investorId)) return null;
  const supabase = await createServerClient();

  const { data: firm, error: firmErr } = await supabase
    .from("investors_mirror")
    .select(
      `id, firm_name, type, website, hq_location,
       thesis_summary, thesis_deep, stage_focus, sector_focus, geo_focus,
       cheque_min_usd, cheque_max_usd, fund_size_usd,
       actively_deploying, synthesis_data, synthesis_confidence,
       connection_brief, investment_pattern, team_expertise,
       ideal_company_profile, value_add, recent_activity,
       linkedin_url, twitter_url, data_quality_score, hardware_fit_score,
       last_enriched`,
    )
    .eq("id", investorId)
    .maybeSingle();

  if (firmErr) {
    console.error("getInvestorProfile firm fetch failed:", firmErr.message);
    return null;
  }
  if (!firm) return null;

  const { data: partnerRows, error: partnersErr } = await supabase
    .from("partners_mirror")
    .select(
      "id, name, title, email, email_tier, linkedin, bio, focus_areas, is_primary_contact",
    )
    .eq("investor_id", investorId)
    .order("is_primary_contact", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true });

  if (partnersErr) {
    console.error("getInvestorProfile partners fetch failed:", partnersErr.message);
  }

  const partners: InvestorProfilePartner[] = (partnerRows ?? []).map((row) => ({
    id: row.id as number,
    name: (row.name as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    email_tier: ((row.email_tier as string | null) ?? null) as EmailTier,
    linkedin: (row.linkedin as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    focus_areas: (row.focus_areas as string | null) ?? null,
    is_primary_contact: Boolean(row.is_primary_contact),
  }));

  // Every campaign_partners row on any partner of this firm the current
  // user can see. RLS caps the set. We show "this investor appears in
  // N campaigns" so the profile visibly ties back into outreach state.
  const partnerIds = partners.map((p) => p.id);
  let campaignLinks: InvestorProfileCampaignLink[] = [];
  if (partnerIds.length > 0) {
    const { data: cpRows, error: cpErr } = await supabase
      .from("campaign_partners")
      .select(
        `id, partner_id, campaign_id, status_code, status_label, last_contact_at,
         campaigns:campaign_id ( id, name )`,
      )
      .in("partner_id", partnerIds)
      .order("last_contact_at", { ascending: false, nullsFirst: false });
    if (cpErr) {
      console.error("getInvestorProfile campaign_partners fetch failed:", cpErr.message);
    } else {
      const rows = (cpRows ?? []) as unknown as Array<{
        id: string;
        partner_id: number;
        campaign_id: string;
        status_code: string | null;
        status_label: string | null;
        last_contact_at: string | null;
        campaigns: { id: string; name: string | null } | null;
      }>;
      const partnerNameById = new Map(partners.map((p) => [p.id, p.name]));
      campaignLinks = rows.map((r) => ({
        campaign_id: r.campaign_id,
        campaign_name: r.campaigns?.name ?? null,
        partner_name: partnerNameById.get(r.partner_id) ?? null,
        status_code: r.status_code,
        status_label: r.status_label,
        last_contact_at: r.last_contact_at,
        days_since_last_contact: daysSince(r.last_contact_at),
      }));
    }
  }

  const firmRow = firm as unknown as {
    id: number;
    firm_name: string | null;
    type: string | null;
    website: string | null;
    hq_location: string | null;
    thesis_summary: string | null;
    thesis_deep: string | null;
    stage_focus: string | null;
    sector_focus: string | null;
    geo_focus: string | null;
    cheque_min_usd: number | null;
    cheque_max_usd: number | null;
    fund_size_usd: number | null;
    actively_deploying: boolean | null;
    synthesis_data: unknown;
    synthesis_confidence: string | null;
    connection_brief: string | null;
    investment_pattern: string | null;
    team_expertise: string | null;
    ideal_company_profile: string | null;
    value_add: string | null;
    recent_activity: string | null;
    linkedin_url: string | null;
    twitter_url: string | null;
    data_quality_score: number | null;
    hardware_fit_score: number | null;
    last_enriched: string | null;
  };

  return {
    id: firmRow.id,
    firm_name: firmRow.firm_name,
    type: firmRow.type,
    website: firmRow.website,
    hq_location: firmRow.hq_location,
    thesis_summary: firmRow.thesis_summary,
    thesis_deep: firmRow.thesis_deep,
    stage_focus: firmRow.stage_focus,
    sector_focus: firmRow.sector_focus,
    geo_focus: firmRow.geo_focus,
    cheque_min_usd: firmRow.cheque_min_usd,
    cheque_max_usd: firmRow.cheque_max_usd,
    fund_size_usd: firmRow.fund_size_usd,
    actively_deploying: firmRow.actively_deploying,
    synthesis_confidence: firmRow.synthesis_confidence,
    connection_brief: firmRow.connection_brief,
    investment_pattern: firmRow.investment_pattern,
    team_expertise: firmRow.team_expertise,
    ideal_company_profile: firmRow.ideal_company_profile,
    value_add: firmRow.value_add,
    recent_activity: firmRow.recent_activity,
    linkedin_url: firmRow.linkedin_url,
    twitter_url: firmRow.twitter_url,
    data_quality_score: firmRow.data_quality_score,
    hardware_fit_score: firmRow.hardware_fit_score,
    last_enriched: firmRow.last_enriched,
    portfolio_companies: parsePortfolioCompanies(firmRow.synthesis_data),
    partners,
    campaign_links: campaignLinks,
  };
}
