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
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent, status")
    .neq("status", "archived")
    .order("name", { ascending: true });

  if (error) {
    // Fail soft — rendering the page with an empty switcher is better than
    // a 500. The switcher itself explains the empty state in copy.
    console.error("listActiveCampaigns failed:", error.message);
    return [];
  }

  // Coerce to the narrow union — Supabase returns `campaign_intent` as
  // text and the DB check constraint guarantees one of the three values.
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    campaign_intent: row.campaign_intent as CampaignSummary["campaign_intent"],
    status: row.status,
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
