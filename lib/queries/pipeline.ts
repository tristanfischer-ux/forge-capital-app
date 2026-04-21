import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";

/**
 * Automation pipeline lanes — queries backing V4 §4
 * (Phase2-Mockup-V4.html lines 1297-1445).
 *
 * V4 renders nine lanes in a horizontal kanban: Approved / Email-verified
 * / Drafted / In Gmail drafts / Reviewed by me / Sent / Reply in /
 * Bounce / OOO auto. Each lane shows a count, a hint, and up to four
 * named partner pills with a "+ N more" overflow row.
 *
 * Honest mapping note — not every V4 lane has a distinct lifecycle
 * signal in V1. We map each lane to exactly one `campaign_partners`
 * status_code so the lane counts sum cleanly to the pipe-summary
 * total. Lanes whose signal lands in a later phase (Email-verified,
 * In Gmail drafts, Reviewed by me) render empty with a title-attribute
 * tooltip flagging the phase that will populate them. This keeps the
 * card grid visually identical to V4 while refusing to double-count
 * real rows.
 */

/* -------------------------------------------------------------------
   Lane configuration — the 9 V4 lanes, in V4 order
   ------------------------------------------------------------------- */

/**
 * One lane's static config. `statusCode` null means the lane has no
 * V1 data source yet; the page renders it as an empty lane with a
 * tooltip flagging the phase that wires it up.
 *
 * `tone` maps to the V4 `.lane-count.<variant>` modifier (dim / red /
 * amber / green). V4 defaults to accent (indigo) when no variant is
 * applied.
 *
 * `pillClass` maps to V4 `.lane-pill.<variant>` (default / warn /
 * blocked). Applied uniformly to pills in the lane because V1 has no
 * per-row "warn/blocked" signal above the lane-level status_code.
 */
export interface LaneConfig {
  /** Compact status code shown above the label ("+1", "-2", …). */
  statusCode: string | null;
  /** V4 lane label ("Approved", "Email-verified", "Drafted", …). */
  label: string;
  /** V4 `.lane-hint` subcopy under the count — verbatim from the mockup. */
  hint: string;
  /** `.lane-count` colour variant (V4 uses these on lanes 2, 7, 8, 9). */
  tone?: "green" | "amber" | "red" | "dim";
  /** `.lane-pill` colour variant applied to every pill in this lane. */
  pillClass?: "warn" | "blocked";
  /** Bottom-of-lane CTA label (verbatim from V4). */
  batchCta: string;
  /** V4 also uses `.lane-batch-btn.ghost` / `.disabled`. */
  batchCtaVariant?: "ghost" | "disabled";
  /** Honest tooltip explaining what wires this lane in V1 (if anything). */
  emptyReason?: string;
}

/**
 * The canonical lane set — one entry per V4 `.lane`, in render order.
 * Copy is lifted verbatim from Phase2-Mockup-V4.html lines 1312-1431.
 *
 * Note on the map from V4 lane → status_code:
 *   - V4 shows separate lanes for Drafted, In Gmail drafts, Reviewed
 *     by me. V1 only has `+2 Drafted`; we show +2 in the Drafted lane
 *     and leave the other two empty until the Gmail sync + review
 *     signals land.
 *   - V4's "Email-verified" lane is a distinct pre-draft step; V1
 *     handles verification at the partner_mirror level, not as a
 *     lifecycle status. Lane renders empty with a tooltip.
 */
export const PIPELINE_LANES: readonly LaneConfig[] = [
  {
    statusCode: "+1",
    label: "Approved",
    hint: "Stephan-approved, not yet verified",
    batchCta: "Batch verify 25 →",
  },
  {
    statusCode: null,
    label: "Email-verified",
    hint: "Hunter s≥80 across all partners",
    tone: "green",
    batchCta: "Batch draft 21 →",
    emptyReason:
      "Email-verification lifecycle lands in Phase 6 — partners are verified at the mirror level today, not as a distinct lane.",
  },
  {
    statusCode: "+2",
    label: "Drafted",
    hint: "LLM wrote first pass · not yet in Gmail",
    batchCta: "Push 18 to Gmail →",
  },
  {
    statusCode: null,
    label: "In Gmail drafts",
    hint: "Safely staged in your account",
    batchCta: "Review →",
    batchCtaVariant: "ghost",
    emptyReason:
      "Gmail draft sync lands in Phase 8 — until then +2 Drafted rows sit in the Drafted lane only.",
  },
  {
    statusCode: null,
    label: "Reviewed by me",
    hint: "Eyeballed, ready to send",
    batchCta: "Open Gmail to send",
    batchCtaVariant: "disabled",
    emptyReason:
      "Reviewed-by-me flag lands in Phase 6 — no per-draft review marker exists in V1 yet.",
  },
  {
    statusCode: "+3",
    label: "Sent",
    hint: "∈ tracker +3 Email sent",
    batchCta: "Nudge 12 stale →",
  },
  {
    statusCode: "+6",
    label: "Reply in",
    hint: "+6 Response received",
    tone: "green",
    batchCta: "Log replies →",
    batchCtaVariant: "ghost",
  },
  {
    statusCode: "-2",
    label: "Bounce",
    hint: "-2 Bounced · auto-removed",
    tone: "red",
    pillClass: "blocked",
    batchCta: "Rescue emails →",
    batchCtaVariant: "ghost",
  },
  {
    statusCode: "+4",
    label: "OOO / auto",
    hint: "+4 Auto-reply received",
    tone: "amber",
    pillClass: "warn",
    batchCta: "Auto-nudge in 3d",
    batchCtaVariant: "disabled",
  },
] as const;

/* -------------------------------------------------------------------
   Lane items — one per partner pill
   ------------------------------------------------------------------- */

export interface LaneItem {
  /** campaign_partners.id — useful once pills become drawer links. */
  partnerId: string;
  /** Firm name from investors_mirror — shown as the main `.lp-name` text. */
  firmName: string | null;
  /** Partner human name from partners_mirror — unused today but carried
   *  so the pd-drawer can render "To {partner} · {firm}" on hover. */
  partnerName: string | null;
  /** Days since last_contact_at, for the pill's right-side `.lp-age`
   *  slot. Null when the row has never been contacted. */
  daysSince: number | null;
}

export interface PipelineLane {
  /** Status code this lane sources from (null for V1-empty lanes). */
  statusCode: string | null;
  /** V4 lane label — human-readable. */
  label: string;
  /** Matching status_code label — used for the underlying "+1 Approved"
   *  title-attribute tooltip on the `.lane-count` number. */
  statusLabel: string | null;
  /** V4 `.lane-hint` subcopy. */
  hint: string;
  /** Count of partners in this lane (= items.length for honest lanes). */
  count: number;
  /** Pills to render inside the lane (capped by `PILLS_VISIBLE`). */
  items: LaneItem[];
  /** Total rows that matched — if > items.length, render "+N more". */
  totalMatched: number;
  /** Style bag surfaced from LaneConfig for the React layer. */
  tone?: "green" | "amber" | "red" | "dim";
  pillClass?: "warn" | "blocked";
  batchCta: string;
  batchCtaVariant?: "ghost" | "disabled";
  /** If set, lane renders empty with this tooltip on the count. */
  emptyReason?: string;
}

/**
 * Max named pills to render per lane before we collapse the tail into
 * a single "+ N more" overflow pill. V4 uses 3-4 visible pills per lane;
 * 4 keeps every lane the same vertical height within a grid row.
 */
const PILLS_VISIBLE = 4;

/* -------------------------------------------------------------------
   The join row shape
   ------------------------------------------------------------------- */

interface PartnerJoinRow {
  id: string;
  status_code: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    investors_mirror: {
      firm_name: string | null;
    } | null;
  } | null;
}

/* -------------------------------------------------------------------
   Public entry point — getPipelineLanes(campaignId)
   ------------------------------------------------------------------- */

/**
 * Fetch every campaign_partners row for the campaign, join partner +
 * investor mirrors, then bucket into V4's 9 lanes by status_code.
 *
 * A single round-trip is cheaper than nine per-lane queries; 500 rows
 * of join output is ~40KB over the wire.
 *
 * Empty lanes (V1 lifecycle gaps) are always returned in the canonical
 * order — the page renders them as empty `.lane` boxes so the grid
 * stays visually identical to V4.
 */
export async function getPipelineLanes(
  campaignId: string,
): Promise<PipelineLane[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      last_contact_at,
      partners_mirror:partner_id (
        name,
        investors_mirror:investor_id (
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .order("last_contact_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("getPipelineLanes failed:", error.message);
    return PIPELINE_LANES.map(emptyLane);
  }

  const rows = (data ?? []) as unknown as PartnerJoinRow[];
  const now = Date.now();

  // Bucket rows by status_code.
  const byCode = new Map<string, LaneItem[]>();
  for (const row of rows) {
    const code = row.status_code;
    if (!code) continue;
    const item: LaneItem = {
      partnerId: row.id,
      firmName: row.partners_mirror?.investors_mirror?.firm_name ?? null,
      partnerName: row.partners_mirror?.name ?? null,
      daysSince: row.last_contact_at
        ? Math.max(
            0,
            Math.floor(
              (now - new Date(row.last_contact_at).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : null,
    };
    const bucket = byCode.get(code);
    if (bucket) bucket.push(item);
    else byCode.set(code, [item]);
  }

  return PIPELINE_LANES.map((cfg) => {
    if (cfg.statusCode === null) return emptyLane(cfg);
    const all = byCode.get(cfg.statusCode) ?? [];
    return {
      statusCode: cfg.statusCode,
      label: cfg.label,
      statusLabel: labelFor(cfg.statusCode),
      hint: cfg.hint,
      count: all.length,
      items: all.slice(0, PILLS_VISIBLE),
      totalMatched: all.length,
      tone: cfg.tone,
      pillClass: cfg.pillClass,
      batchCta: cfg.batchCta,
      batchCtaVariant: cfg.batchCtaVariant,
    };
  });
}

function emptyLane(cfg: LaneConfig): PipelineLane {
  return {
    statusCode: cfg.statusCode,
    label: cfg.label,
    statusLabel: cfg.statusCode ? labelFor(cfg.statusCode) : null,
    hint: cfg.hint,
    count: 0,
    items: [],
    totalMatched: 0,
    tone: cfg.tone,
    pillClass: cfg.pillClass,
    batchCta: cfg.batchCta,
    batchCtaVariant: cfg.batchCtaVariant,
    emptyReason: cfg.emptyReason,
  };
}

/* -------------------------------------------------------------------
   Pipe summary — footer strip below the lane grid
   ------------------------------------------------------------------- */

export interface PipelineSummary {
  /** Total partners in the campaign (sum of all status_code buckets). */
  total: number;
  /** +6/+7/+8/+9/+10/+11/+12 — everything past "approved + past". */
  approvedPast: number;
  /** -2 bounce + any partner at a gate (pipe-summary: "gate-blocked"). */
  gateBlocked: number;
  /** +6 this week (shorthand for the green footer stat). */
  replyInThisWeek: number;
}

/**
 * Footer-strip counts shown under V4's lane grid. Computed from the
 * same dataset pulled for lanes so we stay on one round-trip.
 *
 * "Approved + past" — V4 renders "55 approved + past" as the running
 * tally of everything beyond the initial approval gate (so +1 through
 * +12 inclusive). "Gate-blocked" — partners whose email_tier is
 * generic_blocked or bounced, PLUS anyone at -2.
 *
 * Computed in JS (not SQL) because the lane query already has all
 * rows; a second query would be wasted round-trip.
 */
export async function getPipelineSummary(
  campaignId: string,
): Promise<PipelineSummary> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      status_code,
      last_contact_at,
      partners_mirror:partner_id ( email_tier )
      `,
    )
    .eq("campaign_id", campaignId);

  if (error) {
    console.error("getPipelineSummary failed:", error.message);
    return { total: 0, approvedPast: 0, gateBlocked: 0, replyInThisWeek: 0 };
  }

  interface SummaryJoin {
    status_code: string | null;
    last_contact_at: string | null;
    partners_mirror: { email_tier: string | null } | null;
  }
  const rows = (data ?? []) as unknown as SummaryJoin[];

  const APPROVED_PAST_CODES = new Set([
    "+1",
    "+2",
    "+3",
    "+4",
    "+5",
    "+6",
    "+7",
    "+8",
    "+9",
    "+10",
    "+11",
    "+12",
  ]);
  const WEEK_MS = 1000 * 60 * 60 * 24 * 7;
  const now = Date.now();

  let total = 0;
  let approvedPast = 0;
  let gateBlocked = 0;
  let replyInThisWeek = 0;

  for (const r of rows) {
    total += 1;
    if (r.status_code && APPROVED_PAST_CODES.has(r.status_code)) {
      approvedPast += 1;
    }
    const tier = r.partners_mirror?.email_tier;
    if (
      tier === "generic_blocked" ||
      tier === "bounced" ||
      r.status_code === "-2"
    ) {
      gateBlocked += 1;
    }
    if (r.status_code === "+6" && r.last_contact_at) {
      const dt = new Date(r.last_contact_at).getTime();
      if (Number.isFinite(dt) && now - dt <= WEEK_MS) replyInThisWeek += 1;
    }
  }

  return { total, approvedPast, gateBlocked, replyInThisWeek };
}
