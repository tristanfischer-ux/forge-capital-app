import { createServerClient } from "@/lib/supabase/server";

/**
 * Campaign row as returned to server components. Mirrors the `campaigns`
 * table shape from `001_campaigns.sql`. `status` is free-text but we
 * filter out archived rows at the query layer.
 */
export interface CampaignSummary {
  id: string;
  name: string;
  campaign_intent: "investor" | "customer" | "supplier";
  status: string;
  /** How many campaign_partners rows belong to this campaign (0 if empty). */
  partner_count: number;
}

/**
 * Lists campaigns that are not archived. Used by the authed layout to
 * render the campaign switcher chip row at the top of the page.
 *
 * RLS enforces Tristan-only read access in V1 (see `007_rls.sql`); this
 * query will return an empty array if the caller is unauthenticated.
 */
export async function listActiveCampaigns(): Promise<CampaignSummary[]> {
  const supabase = await createServerClient();

  // Campaigns + a pull of campaign_partners rows. We count in JS to avoid
  // adding a Supabase view migration just for this; with 5 campaigns and
  // ~500 partner rows the payload is trivially small.
  const [campaignsResult, partnersResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, campaign_intent, status")
      .neq("status", "archived")
      .order("name", { ascending: true }),
    supabase.from("campaign_partners").select("campaign_id"),
  ]);

  if (campaignsResult.error) {
    console.error("listActiveCampaigns failed:", campaignsResult.error.message);
    return [];
  }
  if (partnersResult.error) {
    console.error("listActiveCampaigns partner count failed:", partnersResult.error.message);
    // Continue with zero counts — the page still renders usefully.
  }

  const counts = new Map<string, number>();
  for (const row of partnersResult.data ?? []) {
    const id = (row as { campaign_id: string }).campaign_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (campaignsResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    campaign_intent: row.campaign_intent as CampaignSummary["campaign_intent"],
    status: row.status,
    partner_count: counts.get(row.id) ?? 0,
  }));
}

/**
 * Resolves the "current campaign" id for the tracker page. V1 behaviour:
 * read from the `?c=<uuid>` search param. If absent or invalid, return
 * the first active campaign as a sensible default so the page renders.
 * Returns null only if there are no campaigns at all.
 */
export function resolveCurrentCampaignId(
  campaigns: CampaignSummary[],
  searchParamC: string | undefined,
): string | null {
  if (campaigns.length === 0) return null;
  if (searchParamC && campaigns.some((c) => c.id === searchParamC)) {
    return searchParamC;
  }
  return campaigns[0].id;
}
