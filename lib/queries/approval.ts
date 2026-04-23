import { createServerClient } from "@/lib/supabase/server";
import { deriveWhyThem } from "@/lib/queries/tracker";

/**
 * Queries backing the V4 §9 "Founder approval gate" surface
 * (Phase2-Mockup-V4.html lines 1149-1296).
 *
 * Two sides of the artefact:
 *
 *  - OUTGOING  — campaign_partners rows at status_code `+0 Pending approval`.
 *                These are the firms Stephan / Andrew / Olivier hasn't yet
 *                ruled on. Sorted by `created_at` ascending (oldest pending
 *                first, so the queue drains in arrival order).
 *
 *  - INCOMING  — campaign_partners rows that already carry an approval
 *                decision. "Approved" = approved_by IS NOT NULL AND
 *                status_code IN ('+1','+2','+3','+4','+5','+6','+7','+8',
 *                '+9','+10','+11','+12') (i.e. moved past +0). "Rejected"
 *                = status_code = '-3'. "Flag" = approver_note present AND
 *                status_code still = '+0' (the founder sent a note but
 *                didn't greenlight it — needs Tristan to read before send).
 *
 * V1 is read-only. The Phase-6 Gmail reply parser writes `approver_note` /
 * `approved_by` / `approved_at`; the ingest button stubs out until that
 * landing.
 */

/* --------------------------------- types --------------------------------- */

export interface OutgoingApprovalRow {
  campaign_partner_id: string;
  firm_name: string | null;
  hq_location: string | null;
  partner_name: string | null;
  partner_title: string | null;
  /** Synthesis string for the "Why them" column. Null when the mirror hasn't
   *  populated `synthesis_data` yet — page renders an em-dash. Never invented. */
  why_them: string | null;
  created_at: string | null;
}

export interface IncomingApprovalRow {
  campaign_partner_id: string;
  firm_name: string | null;
  partner_name: string | null;
  /** Verbatim reply text parsed from the approver's email reply. */
  approver_note: string | null;
  approved_at: string | null;
  /** Derived decision bucket — approved / flag / rejected. */
  decision: "approved" | "flag" | "rejected";
  /** Haiku parser's self-reported confidence in the decision (0.0–1.0).
   *  Null when the row was decided before migration 028 landed OR when
   *  the parser didn't emit a score. Surfaced on /approval Step 3 as a
   *  coloured badge so low-confidence parses are visibly reviewable.
   *  UX audit 2026-04-23 item #12. */
  parse_confidence: number | null;
}

export interface IncomingApprovalStats {
  approved: number;
  flag: number;
  rejected: number;
}

export interface ApprovalCampaignMeta {
  campaign_id: string;
  /** Internal campaign name — the auditable tracker token (e.g.
   *  "AUDIT · Wren Aerospace · Investor"). Consumers should render
   *  `campaign_display_name` instead when the surface is user-facing. */
  campaign_name: string | null;
  /** User-facing display label (migration 027). Falls back to
   *  `campaign_name` at the caller via `displayNameFor` semantics. UX
   *  audit 2026-04-23 item #2. */
  campaign_display_name: string | null;
  /** Campaign's approver display name (migration 012). Null if not yet set. */
  counterpart_name: string | null;
  /** Count of +0 rows waiting in the outgoing sheet. */
  pending_count: number;
}

/* ---------------------- shape of Supabase join rows ---------------------- */

interface PendingJoinRow {
  id: string;
  created_at: string | null;
  partners_mirror: {
    name: string | null;
    title: string | null;
    investors_mirror: {
      firm_name: string | null;
      hq_location: string | null;
      synthesis_data: unknown;
      investment_pattern: string | null;
      connection_brief: string | null;
      team_expertise: string | null;
    } | null;
  } | null;
}

interface DecidedJoinRow {
  id: string;
  status_code: string | null;
  approver_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  parse_confidence: number | null;
  partners_mirror: {
    name: string | null;
    investors_mirror: {
      firm_name: string | null;
    } | null;
  } | null;
}

/* --------------------------- status classification ----------------------- */

/**
 * The 12 positive codes that represent "past +0 Pending approval" — i.e. the
 * approver greenlit the row and Tristan has moved it into the send pipeline.
 * Kept explicit (not a predicate) so the list is auditable against
 * `lib/status-codes.ts`.
 */
const APPROVED_PAST_PENDING_CODES = new Set([
  "+1", "+2", "+3", "+4", "+5", "+6", "+7", "+8", "+9", "+10", "+11", "+12",
]);

function classifyDecision(
  statusCode: string | null,
  approvedBy: string | null,
  approverNote: string | null,
  approvedAt: string | null,
): "approved" | "flag" | "rejected" | null {
  // The Incoming panel is "what the reply parser returned", not "every row
  // that has ever been rejected". A row only surfaces here if there is real
  // evidence the approver replied: an approver_note (parsed verbatim), an
  // approved_by (their email), or an approved_at timestamp. Without that
  // evidence, legacy -3 Disqualified rows (from tracker imports or pipeline
  // exclusions) used to appear here as ghost "rejections" with empty
  // verbatim text — the exact bug Tristan flagged 2026-04-23.
  const hasReplyEvidence =
    !!approvedBy || !!approverNote || !!approvedAt;
  if (!hasReplyEvidence) return null;

  if (statusCode === "-3") return "rejected";
  if (statusCode && APPROVED_PAST_PENDING_CODES.has(statusCode)) {
    return "approved";
  }
  if (statusCode === "+0" && approverNote && approverNote.trim().length > 0) {
    return "flag";
  }
  return null;
}

/* ------------------------------- queries -------------------------------- */

/**
 * Fetch outgoing-sheet rows — campaign_partners at `+0` for the campaign,
 * joined to firm + primary contact + synthesis. Sorted oldest-first so the
 * queue drains in arrival order (matches V4's "Sorted by match score
 * descending" only when the pipeline pre-ranks +0 inserts; for V1 we use
 * created_at as the deterministic fallback).
 */
export async function getPendingApproval(
  campaignId: string,
): Promise<OutgoingApprovalRow[]> {
  if (!campaignId) return [];
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      created_at,
      partners_mirror:partner_id (
        name,
        title,
        investors_mirror:investor_id (
          firm_name,
          hq_location,
          synthesis_data,
          investment_pattern,
          connection_brief,
          team_expertise
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .eq("status_code", "+0")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getPendingApproval failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as PendingJoinRow[];
  return rows.map((row) => {
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;
    return {
      campaign_partner_id: row.id,
      firm_name: investor?.firm_name ?? null,
      hq_location: investor?.hq_location ?? null,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      why_them: deriveWhyThem(investor),
      created_at: row.created_at,
    };
  });
}

/**
 * Fetch incoming-replies rows — campaign_partners with an approver decision
 * landed. Returns the rows + the three stat counts that populate the
 * "13 Approved · 2 Flag · 5 Rejected" strip in V4.
 *
 * V1 scope: rows are returned all-at-once (no batching). The "Batch 1"
 * label in V4 lines 1229-1234 is a Phase-6 construct once we ingest by
 * reply-thread id.
 */
export async function getApprovalReplies(campaignId: string): Promise<{
  rows: IncomingApprovalRow[];
  stats: IncomingApprovalStats;
}> {
  const empty = {
    rows: [] as IncomingApprovalRow[],
    stats: { approved: 0, flag: 0, rejected: 0 },
  };
  if (!campaignId) return empty;
  const supabase = await createServerClient();

  // Fetch only rows that carry REPLY EVIDENCE — approved_by, approver_note,
  // or approved_at non-null. Previously the filter included status_code = -3
  // which surfaced legacy disqualifications as ghost rejections in the
  // Incoming panel. classifyDecision re-checks evidence and classifies.
  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      approver_note,
      approved_by,
      approved_at,
      parse_confidence,
      partners_mirror:partner_id (
        name,
        investors_mirror:investor_id (
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .or(
      "approved_by.not.is.null,approver_note.not.is.null,approved_at.not.is.null",
    )
    .order("approved_at", { ascending: false });

  if (error) {
    console.error("getApprovalReplies failed:", error.message);
    return empty;
  }

  const raw = (data ?? []) as unknown as DecidedJoinRow[];
  const rows: IncomingApprovalRow[] = [];
  const stats: IncomingApprovalStats = { approved: 0, flag: 0, rejected: 0 };

  for (const row of raw) {
    const decision = classifyDecision(
      row.status_code,
      row.approved_by,
      row.approver_note,
      row.approved_at,
    );
    if (!decision) continue;

    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;

    rows.push({
      campaign_partner_id: row.id,
      firm_name: investor?.firm_name ?? null,
      partner_name: partner?.name ?? null,
      approver_note: row.approver_note,
      approved_at: row.approved_at,
      decision,
      parse_confidence: row.parse_confidence,
    });
    stats[decision] += 1;
  }

  return { rows, stats };
}

/**
 * Meta helper: campaign name + pending-count tile for headers. Kept alongside
 * the two main fetchers so pages don't have to juggle three query modules.
 */
export async function getApprovalCampaignMeta(
  campaignId: string,
): Promise<ApprovalCampaignMeta | null> {
  if (!campaignId) return null;
  const supabase = await createServerClient();

  const [campaignResult, countResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, display_name, counterpart_name")
      .eq("id", campaignId)
      .maybeSingle(),
    supabase
      .from("campaign_partners")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status_code", "+0"),
  ]);

  if (campaignResult.error) {
    console.error("getApprovalCampaignMeta failed:", campaignResult.error.message);
    return null;
  }
  if (!campaignResult.data) return null;

  const row = campaignResult.data as {
    id: string;
    name: string | null;
    display_name?: string | null;
    counterpart_name?: string | null;
  };
  return {
    campaign_id: row.id,
    campaign_name: row.name ?? null,
    campaign_display_name: row.display_name ?? null,
    counterpart_name: row.counterpart_name ?? null,
    pending_count: countResult.count ?? 0,
  };
}
