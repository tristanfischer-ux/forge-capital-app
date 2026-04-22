import { createServerClient } from "@/lib/supabase/server";

/**
 * The 5-tier deliverability taxonomy from `003_partners_mirror.sql`.
 * Only `corresponded` and `hunter_verified` can legitimately advance a
 * partner to +2 Drafted (per V4-FEEDBACK-ROUND-2.md §"Verification tiers").
 * `generic_blocked` and `bounced` must surface as RED badges with a
 * hunt-for-replacement CTA.
 */
export type EmailTier =
  | "corresponded"
  | "hunter_verified"
  | "unverified"
  | "generic_blocked"
  | "bounced"
  | null;

/**
 * A row in the tracker grid — the output of the campaign_partners +
 * partners_mirror + investors_mirror join. Fields we cannot derive from
 * current data resolve to null and render as an em-dash in the grid;
 * we never fabricate.
 */
export interface TrackerRow {
  id: string;
  status_code: string | null;
  status_label: string | null;
  email_tier: EmailTier;
  days_since_last_contact: number | null;
  firm_name: string | null;
  partner_name: string | null;
  partner_title: string | null;
  /** Two-sentence summary derived from `investors_mirror.thesis_summary`. */
  company_summary: string | null;
  /** Why-them synthesis pulled from `investors_mirror.synthesis_data` jsonb. */
  partner_why_them: string | null;
  /** Count of inbound contact_events for this partner (Gmail replies + manual inbound). */
  emails_in: number;
  /** Count of outbound contact_events for this partner (Gmail sends). */
  emails_out: number;
  /** Most recent event_at across any contact_events row for this partner. null when none. */
  last_event_at: string | null;
  /** Summary text of the most recent event — usually the email subject. Truncated to 120 chars. */
  latest_subject: string | null;
}

/**
 * Shape of the raw Supabase join result. Declared here so the mapper
 * can stay strictly typed without leaning on `any`.
 */
interface TrackerJoinRow {
  id: string;
  status_code: string | null;
  status_label: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    title: string | null;
    email_tier: string | null;
    investors_mirror: {
      firm_name: string | null;
      thesis_summary: string | null;
      synthesis_data: unknown;
      investment_pattern: string | null;
      connection_brief: string | null;
      team_expertise: string | null;
    } | null;
  } | null;
}

/**
 * Derives a two-sentence company + investor context paragraph from the
 * investor's thesis_summary. Returns null if the source is empty. We
 * deliberately do not fabricate — if the mirror row has no summary,
 * the grid shows an em-dash.
 *
 * Exported so the match-list surface can derive the same two-sentence
 * blurb without duplicating the logic. Single source of truth for the
 * "company + investor context" microcopy.
 */
export function deriveCompanySummary(thesisSummary: string | null): string | null {
  if (!thesisSummary) return null;
  const trimmed = thesisSummary.trim();
  if (trimmed.length === 0) return null;
  // Split on sentence boundaries, keep the first two. Preserves the
  // original wording from the pipeline — no rewriting.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;
  return sentences.slice(0, 2).join(" ");
}

/**
 * Source shape accepted by `deriveWhyThem`. Matches the columns on
 * `investors_mirror` that carry human-readable synthesis prose.
 */
export interface InvestorSynthesisSource {
  connection_brief?: string | null;
  investment_pattern?: string | null;
  team_expertise?: string | null;
  synthesis_data?: unknown;
}

/**
 * Returns the best available "why them" paragraph for an investor.
 *
 * The Forge Capital pipeline (`research/17-unified-pipeline.py`) writes
 * THREE prose columns alongside a `structured_signals` jsonb:
 *
 *   - `investment_pattern` — 2-4 sentences on what they actually invest in
 *   - `connection_brief`   — 3-5 sentences on visibility / reachability
 *   - `team_expertise`     — 2-4 sentences on what the team knows
 *
 * For the approval sheet the counterpart reads, `investment_pattern` is
 * the most useful (answers "is this investor a fit for this company").
 * We fall through to the others so a row with any one populated still
 * shows real content instead of "synthesis pending".
 *
 * `synthesis_data` is probed last as a legacy fallback — the jsonb holds
 * `structured_signals` (sectors, stage hints) rather than prose, so it
 * rarely contains a string that reads as a why-them. Kept for rows
 * written by older pipeline variants.
 *
 * Exported so the match-list surface and the tracker drawer render the
 * same paragraph (V4-FEEDBACK-ROUND-2.md: "one source of truth, two
 * places it renders").
 */
export function deriveWhyThem(
  source: InvestorSynthesisSource | unknown,
): string | null {
  if (!source || typeof source !== "object") return null;
  const rec = source as InvestorSynthesisSource & Record<string, unknown>;

  const prose = [
    rec.investment_pattern,
    rec.connection_brief,
    rec.team_expertise,
  ];
  for (const v of prose) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }

  const sd = rec.synthesis_data;
  if (sd && typeof sd === "object") {
    const jsonbRec = sd as Record<string, unknown>;
    for (const key of ["why_them", "connection", "intelligent_synthesis"]) {
      const v = jsonbRec[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
  }

  return null;
}

/**
 * Aggregated contact-event stats for one tracker row. Returned by the
 * batch query in `fetchEventAggregates` — NEVER an N+1; the whole
 * campaign is fetched in one round-trip and bucketed in-memory.
 */
interface EventAggregate {
  emails_in: number;
  emails_out: number;
  last_event_at: string | null;
  latest_subject: string | null;
}

/**
 * Fetches contact_events for every campaign_partner_id in `ids` in ONE
 * round-trip (PostgREST `.in()`), then buckets them client-side. Counts
 * inbound vs outbound, picks the most recent summary per partner.
 *
 * Why not a view / SQL aggregation? PostgREST doesn't expose GROUP BY
 * in its select DSL, and we don't want to add a DB function for a V1
 * surface. The row count per campaign is bounded (<10k even for big
 * campaigns; tens once Gmail sync is live) — a single SELECT and an
 * in-process reduce is fine.
 *
 * Direction semantics (per migration 005_contact_events.sql check):
 *   inbound  → emails_in
 *   outbound → emails_out
 *   manual / auto_reply / bounce → neither (don't show as traffic)
 *
 * When no events exist for a partner, its entry is absent from the
 * return map — caller defaults to `{in:0, out:0, null, null}`.
 */
async function fetchEventAggregates(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  ids: string[],
): Promise<Map<string, EventAggregate>> {
  const out = new Map<string, EventAggregate>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("contact_events")
    .select("campaign_partner_id, direction, event_at, summary")
    .in("campaign_partner_id", ids)
    .order("event_at", { ascending: false });

  if (error) {
    console.error("fetchEventAggregates failed:", error.message);
    return out;
  }

  // Rows arrive newest-first; first time we see a partner, record its
  // latest_subject + last_event_at. Counts accumulate over every row.
  type EvRow = {
    campaign_partner_id: string;
    direction: string | null;
    event_at: string;
    summary: string | null;
  };
  const rows = (data ?? []) as unknown as EvRow[];
  for (const ev of rows) {
    let agg = out.get(ev.campaign_partner_id);
    if (!agg) {
      const summary = (ev.summary ?? "").trim();
      agg = {
        emails_in: 0,
        emails_out: 0,
        last_event_at: ev.event_at,
        latest_subject: summary.length > 0
          ? (summary.length > 120 ? summary.slice(0, 120) : summary)
          : null,
      };
      out.set(ev.campaign_partner_id, agg);
    }
    if (ev.direction === "inbound") agg.emails_in += 1;
    else if (ev.direction === "outbound") agg.emails_out += 1;
  }
  return out;
}

/**
 * Deliverability-tier filter accepted by `getTrackerRows`. Non-null
 * value narrows the returned rows to partners whose `email_tier`
 * matches. `unverified` is the home for NULL `email_tier` too — the
 * tier aggregate query rolls nulls into that bucket, and we do the
 * same here for consistency.
 *
 * Used by the verification-gate deep-links (`/tracker?tier=<tier>`)
 * so the founder can jump straight from the gate to the affected
 * subset.
 */
export type TrackerTierFilter =
  | "corresponded"
  | "hunter_verified"
  | "unverified"
  | "generic_blocked"
  | "bounced";

const VALID_TIER_FILTERS: readonly TrackerTierFilter[] = [
  "corresponded",
  "hunter_verified",
  "unverified",
  "generic_blocked",
  "bounced",
];

/**
 * Type guard for validating a user-supplied `?tier=` search param. We
 * use this rather than casting so an unknown string fails loudly and
 * falls through to the unfiltered rendering.
 */
export function isTrackerTierFilter(v: unknown): v is TrackerTierFilter {
  return typeof v === "string" && (VALID_TIER_FILTERS as readonly string[]).includes(v);
}

/**
 * Fetches tracker rows for a given campaign. Read-only — V1 does not
 * support in-page status edits (that lands in Phase 5).
 *
 * Two queries:
 *   1. campaign_partners + embedded mirror joins (1 round-trip)
 *   2. contact_events aggregated by campaign_partner_id (1 round-trip)
 * Merged in-memory to produce per-row inbound/outbound counts +
 * most-recent-event metadata without an N+1.
 *
 * Optional `tierFilter` narrows the result to rows whose partner
 * `email_tier` matches. Done post-fetch (Supabase's `.in()` filter
 * can't traverse the embedded join cleanly) — still single-pass, and
 * the row count per campaign is bounded.
 *
 * The mirrors (`partners_mirror`, `investors_mirror`) are populated by
 * the nightly sync; until that has run for the first time the result
 * will be empty and the tracker page renders its honest empty state.
 * `contact_events` is currently empty until the Gmail sync daemon
 * lands — tracker rows render with "no email traffic yet" per row.
 */
export async function getTrackerRows(
  campaignId: string,
  tierFilter?: TrackerTierFilter | null,
): Promise<TrackerRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      status_label,
      last_contact_at,
      partners_mirror:partner_id (
        name,
        title,
        email_tier,
        investors_mirror:investor_id (
          firm_name,
          thesis_summary,
          synthesis_data,
          investment_pattern,
          connection_brief,
          team_expertise
        )
      )
      `,
    )
    .eq("campaign_id", campaignId);

  if (error) {
    // Server component will render the empty-state copy; an error here
    // generally means RLS denied access (unauthenticated request) or
    // the mirror tables have not been populated yet.
    console.error("getTrackerRows failed:", error.message);
    return [];
  }

  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;

  // Supabase's generated types model embedded relations as arrays even
  // for to-one relations, so we normalise via an intermediate cast.
  const allRows = (data ?? []) as unknown as TrackerJoinRow[];

  // Tier filter — applied post-fetch because the partners_mirror join
  // is embedded rather than joined at SQL level. NULL email_tier folds
  // into `unverified`, mirroring the aggregate counts on the gate.
  const rows = tierFilter
    ? allRows.filter((r) => {
        const raw = r.partners_mirror?.email_tier ?? null;
        const effective: TrackerTierFilter = raw && (VALID_TIER_FILTERS as readonly string[]).includes(raw)
          ? (raw as TrackerTierFilter)
          : "unverified";
        return effective === tierFilter;
      })
    : allRows;

  // Second round-trip: aggregate contact_events per campaign_partner_id.
  const aggregates = await fetchEventAggregates(
    supabase,
    rows.map((r) => r.id),
  );

  return rows.map((row) => {
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;

    const daysSince = row.last_contact_at
      ? Math.max(
          0,
          Math.floor((now - new Date(row.last_contact_at).getTime()) / msPerDay),
        )
      : null;

    const agg = aggregates.get(row.id);

    return {
      id: row.id,
      status_code: row.status_code,
      status_label: row.status_label,
      email_tier: (partner?.email_tier ?? null) as EmailTier,
      days_since_last_contact: daysSince,
      firm_name: investor?.firm_name ?? null,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      company_summary: deriveCompanySummary(investor?.thesis_summary ?? null),
      partner_why_them: deriveWhyThem(investor),
      emails_in: agg?.emails_in ?? 0,
      emails_out: agg?.emails_out ?? 0,
      last_event_at: agg?.last_event_at ?? null,
      latest_subject: agg?.latest_subject ?? null,
    };
  });
}
