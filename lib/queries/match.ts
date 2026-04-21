import { createServerClient } from "@/lib/supabase/server";
import {
  deriveCompanySummary,
  deriveWhyThem,
  type EmailTier,
} from "@/lib/queries/tracker";
import type {
  MatchFilters,
  MatchRow,
  MatchSortDir,
  MatchSortKey,
} from "@/lib/queries/match-types";

/**
 * Match-list surface data layer. Ports the V4 mockup §"Find a match"
 * results grid (Phase2-Mockup-V4.html lines 912–1146) onto real
 * Supabase mirrors, with the two round-2 corrections applied:
 *
 *   1. Two sentences of company + partner context per row (same
 *      helpers as the tracker).
 *   2. Dedupe against existing DB — exclude firms already in ANY
 *      campaign_partners row for the currently-selected campaign.
 *      Optional toggle bypasses dedupe.
 *
 * V1 does not invent a 0–100 scoring number. `data_quality_score`
 * was referenced in the build brief but no such column exists on
 * `investors_mirror` (schema is migration 002). The query therefore
 * offers two sort orders grounded in what's actually stored:
 *   - firm_name asc (default — stable, predictable)
 *   - last_synced_at desc (newest-synced first)
 * Adding a real score is a follow-up that should land with a
 * migration introducing the column.
 *
 * Pure types + formatters live in `match-types.ts` so the client grid
 * can import them without pulling `next/headers` into a client bundle.
 * This file exports the server-only query.
 */

// Re-export the pure types so existing imports from this module still
// resolve — server-only callers can continue to `import { MatchRow }
// from "@/lib/queries/match"` after the split.
export type { MatchFilters, MatchRow, MatchSortDir, MatchSortKey };

export interface GetMatchRowsOptions {
  campaignId: string;
  filters: MatchFilters;
  /** Include firms already in the campaign (dedupe OFF). Default false. */
  includeExisting: boolean;
  sortKey: MatchSortKey;
  sortDir: MatchSortDir;
  pageSize: number;
  page: number;
}

export interface GetMatchRowsResult {
  rows: MatchRow[];
  total: number;
}

/**
 * Supabase returns embedded joins as arrays even for to-one. This
 * interface models what the join actually returns before we normalise.
 */
interface InvestorJoinRow {
  id: number;
  firm_name: string | null;
  hq_location: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
  cheque_min_usd: number | null;
  cheque_max_usd: number | null;
  fund_size_usd: number | null;
  thesis_summary: string | null;
  thesis_deep: string | null;
  synthesis_data: unknown;
  partners_mirror: Array<{
    id: number;
    name: string | null;
    title: string | null;
    email_tier: string | null;
    is_primary_contact: boolean | null;
  }>;
}

/**
 * Cleans a user-supplied filter value for ilike matching. Wraps the
 * trimmed value in `%` and escapes PostgREST wildcard characters so a
 * stray `%` or `,` in input can't alter the query structure. The
 * filter is otherwise case-insensitive — ilike handles that.
 */
function toIlikePattern(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // PostgREST parses commas + parens as separators. Escape them.
  const safe = trimmed
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "\\,")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  return `%${safe}%`;
}

/**
 * Fetch match rows for the match-list page.
 *
 * Dedupe strategy: we fetch `campaign_partners` ids for the campaign in
 * one query, build a Set of investor_ids already on the campaign, and
 * either exclude them or annotate them. Supabase PostgREST does not
 * expose a proper NOT EXISTS subquery, so we do a two-step. The set is
 * tiny (≤ a few thousand) and the round-trip is cheap.
 */
export async function getMatchRows(
  opts: GetMatchRowsOptions,
): Promise<GetMatchRowsResult> {
  const {
    campaignId,
    filters,
    includeExisting,
    sortKey,
    sortDir,
    pageSize,
    page,
  } = opts;

  const supabase = await createServerClient();

  // Step 1: resolve the "already in campaign" investor-id set so we can
  // either exclude or annotate. One query — campaign_partners → join
  // through partners_mirror to resolve the investor_id.
  const { data: existingRows, error: existingErr } = await supabase
    .from("campaign_partners")
    .select("partner_id, partners_mirror:partner_id ( investor_id )")
    .eq("campaign_id", campaignId);

  if (existingErr) {
    console.error("getMatchRows existing-lookup failed:", existingErr.message);
    return { rows: [], total: 0 };
  }

  const existingInvestorIds = new Set<number>();
  for (const row of existingRows ?? []) {
    // Supabase embeds to-one as either array or object depending on the
    // FK shape — partner_id is scalar, so this comes back as an object.
    const partner = (row as { partners_mirror: unknown }).partners_mirror;
    if (partner && typeof partner === "object" && "investor_id" in partner) {
      const id = (partner as { investor_id: unknown }).investor_id;
      if (typeof id === "number") existingInvestorIds.add(id);
    }
  }

  // Step 2: build the investors_mirror query. We embed partners_mirror
  // as a to-many relation so we can pick the primary contact row
  // client-side without a second round-trip.
  let query = supabase
    .from("investors_mirror")
    .select(
      `
      id,
      firm_name,
      hq_location,
      sector_focus,
      stage_focus,
      geo_focus,
      cheque_min_usd,
      cheque_max_usd,
      fund_size_usd,
      thesis_summary,
      thesis_deep,
      synthesis_data,
      partners_mirror:partners_mirror!partners_mirror_investor_id_fkey (
        id, name, title, email_tier, is_primary_contact
      )
      `,
      { count: "exact" },
    )
    .eq("actively_deploying", true);

  // Apply filters — ilike on the flat text columns. Thesis searches
  // against both the short summary and the deep text via `.or()`.
  const sectorPat = toIlikePattern(filters.sector);
  if (sectorPat) query = query.ilike("sector_focus", sectorPat);
  const stagePat = toIlikePattern(filters.stage);
  if (stagePat) query = query.ilike("stage_focus", stagePat);
  const geoPat = toIlikePattern(filters.geo);
  if (geoPat) query = query.ilike("geo_focus", geoPat);
  const thesisPat = toIlikePattern(filters.thesis);
  if (thesisPat) {
    // Matches either short-form summary or deep-form. Both are free-text
    // from the pipeline's 17-unified-pipeline.py.
    query = query.or(
      `thesis_summary.ilike.${thesisPat},thesis_deep.ilike.${thesisPat}`,
    );
  }

  // Dedupe: exclude ids already in the campaign unless the caller has
  // opted in via the toggle. `.not("id", "in", "(...)")` is the
  // PostgREST idiom; cap the set to protect the URL length (if the user
  // somehow has 10,000 firms in a campaign, PostgREST will 414). V1 is
  // safe up to a few thousand — Phase 5 swaps to an RPC if needed.
  if (!includeExisting && existingInvestorIds.size > 0) {
    const idList = Array.from(existingInvestorIds).join(",");
    query = query.not("id", "in", `(${idList})`);
  }

  // Sort + paginate. Supabase range is inclusive at both ends.
  const ascending = sortDir === "asc";
  if (sortKey === "firm_name") {
    query = query.order("firm_name", { ascending, nullsFirst: false });
  } else {
    query = query.order("last_synced_at", { ascending, nullsFirst: false });
  }
  // Secondary sort on id keeps pagination stable when the primary key ties.
  query = query.order("id", { ascending: true });

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) {
    console.error("getMatchRows failed:", error.message);
    return { rows: [], total: 0 };
  }

  const joinRows = (data ?? []) as unknown as InvestorJoinRow[];

  const rows: MatchRow[] = joinRows.map((inv) => {
    const partners = inv.partners_mirror ?? [];
    // Pick a primary contact if one is flagged, else the first partner.
    // If the firm has zero partners, fall back to null — the UI will
    // render "No partner on file" rather than fabricate.
    const primary =
      partners.find((p) => p.is_primary_contact === true) ??
      partners[0] ??
      null;

    return {
      investor_id: inv.id,
      firm_name: inv.firm_name,
      hq_location: inv.hq_location,
      sector_focus: inv.sector_focus,
      stage_focus: inv.stage_focus,
      geo_focus: inv.geo_focus,
      cheque_min_usd: inv.cheque_min_usd,
      cheque_max_usd: inv.cheque_max_usd,
      fund_size_usd: inv.fund_size_usd,
      primary_partner: primary
        ? {
            id: primary.id,
            name: primary.name,
            title: primary.title,
            email_tier: (primary.email_tier ?? null) as EmailTier,
          }
        : null,
      company_summary: deriveCompanySummary(inv.thesis_summary),
      why_them: deriveWhyThem(inv.synthesis_data),
      already_in_campaign: existingInvestorIds.has(inv.id),
    };
  });

  return { rows, total: count ?? rows.length };
}

// `formatChequeRange` + helpers live in `match-types.ts` — re-exporting
// here would re-introduce the server-client import cycle.
