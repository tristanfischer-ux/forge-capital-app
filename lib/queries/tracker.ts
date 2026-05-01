import { createServerClient } from "@/lib/supabase/server";

/**
 * The deliverability taxonomy from `003_partners_mirror.sql` extended with
 * the NeverBounce tiers added in 2026-04-23.
 *
 * Sendable bucket (can advance a partner to +2 Drafted):
 *   - `corresponded` — we have replied to this address (highest)
 *   - `hunter_verified` — Hunter score 90+, SMTP probe accepted
 *   - `neverbounce_valid` — NeverBounce confirmed deliverable
 *   - `neverbounce_catchall` — NeverBounce reports the domain accepts all,
 *     so the address may bounce but is not known-bad
 *
 * Uncertain bucket (cannot advance until upgraded):
 *   - `neverbounce_unknown` — NeverBounce returned no verdict
 *   - `unverified` — pattern guessed or no Hunter probe at all
 *
 * Blocked bucket (RED — drafts will not generate, hunt for replacement):
 *   - `generic_blocked` — info@ / contact@ / hello@ — never sent
 *   - `neverbounce_invalid` — NeverBounce confirmed undeliverable
 *   - `neverbounce_disposable` — disposable / throwaway address
 *   - `bounced` — Gmail returned a hard bounce when we tried
 */
export type EmailTier =
  | "corresponded"
  | "hunter_verified"
  | "neverbounce_valid"
  | "neverbounce_catchall"
  | "neverbounce_unknown"
  | "unverified"
  | "generic_blocked"
  | "neverbounce_invalid"
  | "neverbounce_disposable"
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
  /** partners_mirror.id — used for deep-linking the FIRM · CONTACT name to /partner/[id]. */
  partner_id: number | null;
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
  /** True when status_code >= +1 (email sent), the most recent contact
   *  event is outbound, and it is older than 5 days with no inbound
   *  reply since. Read-only UI hint — not automation. */
  needs_follow_up: boolean;
  /** True if at least one email_opened tracking event exists for this partner. */
  email_opened: boolean;
  /** True if at least one link_clicked tracking event exists for this partner. */
  link_clicked: boolean;
  /** Names of OTHER campaigns this partner appears in (cross-campaign awareness). Empty when single-campaign only. */
  other_campaigns: string[];
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
    id: number | null;
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
  /** Direction of the most recent event — used by the follow-up hint. */
  latest_direction: "inbound" | "outbound" | null;
  /** Set to true if any event has event_type='email_opened'. */
  email_opened: boolean;
  /** Set to true if any event has event_type='link_clicked'. */
  link_clicked: boolean;
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
    .select("campaign_partner_id, direction, event_at, summary, event_type")
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
    event_type: string | null;
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
        latest_direction:
          ev.direction === "inbound" || ev.direction === "outbound"
            ? ev.direction
            : null,
        email_opened: false,
        link_clicked: false,
      };
      out.set(ev.campaign_partner_id, agg);
    }
    if (ev.direction === "inbound") agg.emails_in += 1;
    else if (ev.direction === "outbound") agg.emails_out += 1;
    if (ev.event_type === "email_opened") agg.email_opened = true;
    if (ev.event_type === "link_clicked") agg.link_clicked = true;
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
  | "neverbounce_valid"
  | "neverbounce_catchall"
  | "neverbounce_unknown"
  | "unverified"
  | "generic_blocked"
  | "neverbounce_invalid"
  | "neverbounce_disposable"
  | "bounced";

const VALID_TIER_FILTERS: readonly TrackerTierFilter[] = [
  "corresponded",
  "hunter_verified",
  "neverbounce_valid",
  "neverbounce_catchall",
  "neverbounce_unknown",
  "unverified",
  "generic_blocked",
  "neverbounce_invalid",
  "neverbounce_disposable",
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
 * Determines whether a tracker row should show a "Follow up?" hint.
 *
 * Conditions (all must be true):
 *   1. status_code is a positive integer >= 1 (email has been sent)
 *   2. The most recent contact_event is outbound
 *   3. That outbound event is older than 5 days
 *   4. There are zero inbound replies (emails_in === 0)
 *
 * This is a read-only UI hint — it does not trigger any automation.
 */
function computeFollowUpHint(
  statusCode: string | null,
  latestDirection: "inbound" | "outbound" | null,
  lastEventAt: string | null,
  emailsIn: number,
): boolean {
  if (!statusCode) return false;
  // Parse the status_code (e.g. "+1", "+2"). Must be >= 1.
  const codeNum = parseInt(statusCode, 10);
  if (!Number.isFinite(codeNum) || codeNum < 1) return false;
  // Most recent event must be outbound.
  if (latestDirection !== "outbound") return false;
  // Must have no inbound replies.
  if (emailsIn > 0) return false;
  // Last event must be older than 5 days.
  if (!lastEventAt) return false;
  const ageMs = Date.now() - new Date(lastEventAt).getTime();
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  return ageMs > fiveDaysMs;
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
        id,
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

  // Third round-trip: cross-campaign awareness from investor_outreach_state.
  const partnerIds = rows
    .map((r) => r.partners_mirror?.id)
    .filter((id): id is number => id != null);
  const otherCampaignMap = new Map<number, string[]>();
  if (partnerIds.length > 0) {
    const { data: outreachData } = await supabase
      .from("investor_outreach_state")
      .select("partner_id, total_campaigns_active, last_campaign_name")
      .in("partner_id", partnerIds)
      .gt("total_campaigns_active", 1);
    if (outreachData) {
      // For partners in multiple campaigns, fetch ALL their campaign names
      const multiPartnerIds = outreachData.map(
        (r: { partner_id: number }) => r.partner_id,
      );
      if (multiPartnerIds.length > 0) {
        const { data: cpRows } = await supabase
          .from("campaign_partners")
          .select("partner_id, campaign_id, campaigns:campaign_id(name)")
          .in("partner_id", multiPartnerIds)
          .neq("campaign_id", campaignId);
        if (cpRows) {
          for (const cp of cpRows as unknown as Array<{
            partner_id: number;
            campaign_id: string;
            campaigns: { name: string } | { name: string }[] | null;
          }>) {
            const c = cp.campaigns;
            const name = Array.isArray(c) ? c[0]?.name : c?.name;
            if (!name) continue;
            const existing = otherCampaignMap.get(cp.partner_id) ?? [];
            if (!existing.includes(name)) existing.push(name);
            otherCampaignMap.set(cp.partner_id, existing);
          }
        }
      }
    }
  }

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
      partner_id: partner?.id ?? null,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      company_summary: deriveCompanySummary(investor?.thesis_summary ?? null),
      partner_why_them: deriveWhyThem(investor),
      emails_in: agg?.emails_in ?? 0,
      emails_out: agg?.emails_out ?? 0,
      last_event_at: agg?.last_event_at ?? null,
      latest_subject: agg?.latest_subject ?? null,
      needs_follow_up: computeFollowUpHint(
        row.status_code,
        agg?.latest_direction ?? null,
        agg?.last_event_at ?? null,
        agg?.emails_in ?? 0,
      ),
      email_opened: agg?.email_opened ?? false,
      link_clicked: agg?.link_clicked ?? false,
      other_campaigns: otherCampaignMap.get(partner?.id ?? -1) ?? [],
    };
  });
}
