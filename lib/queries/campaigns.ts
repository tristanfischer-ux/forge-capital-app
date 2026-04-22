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
  /** Timestamp the campaign row was created. Drives "week N of 16" clock. */
  created_at: string | null;
  /** Editable per-campaign metadata. Nullable — UI shows an honest
   *  empty state + "Edit campaign" affordance when missing. */
  counterpart_name: string | null;
  counterpart_email: string | null;
  counterpart_role: string | null;
  week_started_at: string | null;
  week_count_target: number | null;
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
      .select(
        "id, name, campaign_intent, status, created_at, counterpart_name, counterpart_email, counterpart_role, week_started_at, week_count_target",
      )
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

  interface CampaignJoinRow {
    id: string;
    name: string;
    campaign_intent: string;
    status: string;
    created_at: string | null;
    counterpart_name: string | null;
    counterpart_email: string | null;
    counterpart_role: string | null;
    week_started_at: string | null;
    week_count_target: number | null;
  }
  const campaignRows = (campaignsResult.data ?? []) as unknown as CampaignJoinRow[];
  return campaignRows.map((row) => ({
    id: row.id,
    name: row.name,
    campaign_intent: row.campaign_intent as CampaignSummary["campaign_intent"],
    status: row.status,
    partner_count: counts.get(row.id) ?? 0,
    created_at: row.created_at ?? null,
    counterpart_name: row.counterpart_name,
    counterpart_email: row.counterpart_email,
    counterpart_role: row.counterpart_role,
    week_started_at: row.week_started_at,
    week_count_target: row.week_count_target,
  }));
}

/** Returns the counterpart_name if set, else a fallback. Callers pass
 *  a variant — "title" for headings ("Andrew Murphy"), "phrase" for
 *  mid-sentence use ("your counterpart"), or "possessive" for things
 *  like "Stephan's reply" → "your counterpart's reply". Used
 *  everywhere the V4 mockup hardcoded "Stephan". */
export function counterpartLabel(
  campaign: Pick<CampaignSummary, "counterpart_name">,
  variant: "title" | "phrase" | "possessive" = "phrase",
): string {
  const name = campaign.counterpart_name?.trim();
  if (name) {
    if (variant === "possessive") {
      // "Andrew" → "Andrew's"; "Mary Ellis" → "Mary Ellis's"
      return name.endsWith("s") ? `${name}'` : `${name}'s`;
    }
    return name;
  }
  if (variant === "title") return "Counterpart TBD";
  if (variant === "possessive") return "the counterpart's";
  return "the counterpart";
}

/** Compute "Week N of M" from the campaign's week_started_at clock.
 *  Returns null if week_started_at isn't set — UI falls back to an
 *  honest "Week 1 · starting" or just the campaign name. */
export function computeCampaignWeek(
  campaign: Pick<CampaignSummary, "week_started_at" | "week_count_target">,
): { current: number; total: number } | null {
  if (!campaign.week_started_at) return null;
  const start = new Date(campaign.week_started_at);
  if (Number.isNaN(start.getTime())) return null;
  const elapsedMs = Date.now() - start.getTime();
  const weeksElapsed = Math.floor(elapsedMs / (7 * 24 * 60 * 60 * 1000));
  const current = Math.max(1, weeksElapsed + 1);
  const total = campaign.week_count_target ?? 16;
  return { current, total };
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
