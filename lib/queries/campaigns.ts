import { createServerClient } from "@/lib/supabase/server";

/**
 * Campaign row as returned to server components. Mirrors the `campaigns`
 * table shape from `001_campaigns.sql`. `status` is free-text but we
 * filter out archived rows at the query layer.
 */
export interface CampaignSummary {
  id: string;
  name: string;
  /** User-facing label used in email subjects, approval sheet titles,
   *  weekly digest headers, and the outbound email-list subject. Null
   *  when the column is unset for this campaign; use `displayNameFor`
   *  to resolve to `name` as a fallback. Introduced by migration 027
   *  (UX audit 2026-04-23 item #2) to stop internal tracker tokens
   *  ("AUDIT · Wren Aerospace · Investor") leaking into real
   *  counterparty-facing strings. */
  display_name: string | null;
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
        "id, name, display_name, campaign_intent, status, created_at, counterpart_name, counterpart_email, counterpart_role, week_started_at, week_count_target",
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
    display_name: string | null;
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
    display_name: row.display_name ?? null,
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

// Pure helpers live in `campaigns-shared.ts` — importing from `campaigns.ts`
// drags `next/headers` (via `@/lib/supabase/server`) into any "use client"
// bundle, so the helpers were split out. Re-export here to keep existing
// server-side imports working.
export {
  counterpartLabel,
  computeCampaignWeek,
  displayNameFor,
  resolveCurrentCampaignId,
} from "./campaigns-shared";
