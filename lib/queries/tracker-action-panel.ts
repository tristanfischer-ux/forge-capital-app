import { createServerClient } from "@/lib/supabase/server";

/**
 * Queries backing the tracker "Next-step action panel" (UX audit
 * 2026-04-23 item #7). The old right-side summary chart told Tristan
 * how many rows sat in each status — a chart, not a decision. The
 * replacement surfaces three things he can ACT on:
 *
 *   1. `pendingApprovalCount`  — how many rows at +0 Pending approval.
 *       Drives the primary CTA to /approval/sheet/<campaignId>.
 *   2. `recentEvents`          — last 5 contact_events on this campaign,
 *       newest first. Shows firm + event_type + relative time so the
 *       founder sees the pulse of the campaign at a glance.
 *   3. `needsAttention`        — rows that are stuck at a decision
 *       boundary per the 16-code vocabulary:
 *         - +6 Response received but no outbound follow-up in > 5 days
 *         - +7 Meeting offered idle > 3 days
 *         - +10 NDA / diligence idle > 14 days
 *       Each row links to the partner profile.
 *
 * All three bits are read-only and derive from `campaign_partners` +
 * `contact_events` rows for the single active campaign. One function,
 * one round-trip budget per concern. RLS does the rest.
 */

export interface TrackerRecentEvent {
  /** campaign_partners.id — for deep-linking to the partner profile. */
  campaign_partner_id: string;
  /** partners_mirror.id — used by /partner/[id] routes. */
  partner_id: number | null;
  firm_name: string | null;
  partner_name: string | null;
  /** contact_events.event_type (e.g. outbound_first_contact, reply, meeting_scheduled). */
  event_type: string | null;
  direction: string | null;
  event_at: string;
  summary: string | null;
}

export interface TrackerAttentionRow {
  campaign_partner_id: string;
  partner_id: number | null;
  firm_name: string | null;
  partner_name: string | null;
  status_code: string;
  /** The rule that flagged this row — short sentence the UI shows. */
  reason: string;
  /** Days since last-contact (or days in state). Drives sort order. */
  idle_days: number;
}

export interface TrackerActionPanelData {
  pendingApprovalCount: number;
  recentEvents: TrackerRecentEvent[];
  needsAttention: TrackerAttentionRow[];
}

/* --------------------------- status thresholds -------------------------- */

/** Hours (not days) so "just crossed the threshold" renders as 5d 2h etc. */
const DAY_MS = 24 * 60 * 60 * 1000;

const ATTENTION_THRESHOLDS: Record<string, { days: number; reason: (idle: number) => string }> = {
  "+6": {
    days: 5,
    reason: (idle) =>
      `Response received ${idle}d ago — no follow-up sent yet`,
  },
  "+7": {
    days: 3,
    reason: (idle) =>
      `Meeting offered ${idle}d ago — awaiting inbound`,
  },
  "+10": {
    days: 14,
    reason: (idle) => `NDA / diligence idle ${idle}d`,
  },
};

/* --------------------------------- join types --------------------------- */

interface EventJoinRow {
  id: string;
  campaign_partner_id: string;
  event_type: string | null;
  direction: string | null;
  event_at: string;
  summary: string | null;
}

interface AttentionJoinRow {
  id: string;
  status_code: string | null;
  last_contact_at: string | null;
  updated_at: string | null;
  partners_mirror: {
    id: number | null;
    name: string | null;
    investors_mirror: {
      firm_name: string | null;
    } | null;
  } | null;
}

/* ---------------------------- public fetcher ---------------------------- */

export async function getTrackerActionPanel(
  campaignId: string,
): Promise<TrackerActionPanelData> {
  const empty: TrackerActionPanelData = {
    pendingApprovalCount: 0,
    recentEvents: [],
    needsAttention: [],
  };
  if (!campaignId) return empty;

  const supabase = await createServerClient();

  // 1) pending count — cheap HEAD query, no row payload.
  const pendingResultPromise = supabase
    .from("campaign_partners")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status_code", "+0");

  // 2) "needs attention" rows — pull status_code + last_contact_at for
  //    every row at one of the flagged statuses; classify in JS so the
  //    rules stay readable and are easy to extend.
  const attentionRowsPromise = supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      last_contact_at,
      updated_at,
      partners_mirror:partner_id (
        id,
        name,
        investors_mirror:investor_id (
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .in("status_code", Object.keys(ATTENTION_THRESHOLDS));

  // 3) recent events — scoped to the campaign via a subquery on
  //    campaign_partner_id → campaign_id. Postgrest doesn't join the
  //    parent table directly, so we fetch the campaign's partner ids
  //    first and filter events by `.in()`.
  const campaignPartnersPromise = supabase
    .from("campaign_partners")
    .select(
      `
      id,
      partners_mirror:partner_id (
        id,
        name,
        investors_mirror:investor_id (
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .limit(5000);

  const [pendingResult, attentionResult, cpResult] = await Promise.all([
    pendingResultPromise,
    attentionRowsPromise,
    campaignPartnersPromise,
  ]);

  const pendingApprovalCount = pendingResult.count ?? 0;

  // Build partner-level metadata keyed by campaign_partner_id so we can
  // label recent events without re-joining.
  const partnerMetaByCpId = new Map<
    string,
    { partnerId: number | null; partnerName: string | null; firmName: string | null }
  >();
  if (!cpResult.error) {
    for (const row of (cpResult.data ?? []) as unknown as AttentionJoinRow[]) {
      partnerMetaByCpId.set(row.id, {
        partnerId: row.partners_mirror?.id ?? null,
        partnerName: row.partners_mirror?.name ?? null,
        firmName: row.partners_mirror?.investors_mirror?.firm_name ?? null,
      });
    }
  } else {
    console.error("getTrackerActionPanel cp fetch failed:", cpResult.error.message);
  }

  const cpIds = Array.from(partnerMetaByCpId.keys());

  let recentEvents: TrackerRecentEvent[] = [];
  if (cpIds.length > 0) {
    const eventsResult = await supabase
      .from("contact_events")
      .select("id, campaign_partner_id, event_type, direction, event_at, summary")
      .in("campaign_partner_id", cpIds)
      .order("event_at", { ascending: false })
      .limit(5);
    if (eventsResult.error) {
      console.error(
        "getTrackerActionPanel events fetch failed:",
        eventsResult.error.message,
      );
    } else {
      const eventRows = (eventsResult.data ?? []) as unknown as EventJoinRow[];
      recentEvents = eventRows.map((e) => {
        const meta = partnerMetaByCpId.get(e.campaign_partner_id);
        return {
          campaign_partner_id: e.campaign_partner_id,
          partner_id: meta?.partnerId ?? null,
          firm_name: meta?.firmName ?? null,
          partner_name: meta?.partnerName ?? null,
          event_type: e.event_type,
          direction: e.direction,
          event_at: e.event_at,
          summary: e.summary,
        };
      });
    }
  }

  // Classify "needs attention".
  const now = Date.now();
  const needsAttention: TrackerAttentionRow[] = [];
  if (!attentionResult.error) {
    const rows = (attentionResult.data ?? []) as unknown as AttentionJoinRow[];
    for (const row of rows) {
      if (!row.status_code) continue;
      const threshold = ATTENTION_THRESHOLDS[row.status_code];
      if (!threshold) continue;
      // Use last_contact_at as the idle clock; fall back to updated_at
      // when the sync hasn't stamped last_contact_at (belt-and-braces —
      // the Gmail daemon is the canonical writer for last_contact_at).
      const anchorIso = row.last_contact_at ?? row.updated_at ?? null;
      if (!anchorIso) continue;
      const anchor = Date.parse(anchorIso);
      if (Number.isNaN(anchor)) continue;
      const idleDays = Math.floor((now - anchor) / DAY_MS);
      if (idleDays < threshold.days) continue;
      needsAttention.push({
        campaign_partner_id: row.id,
        partner_id: row.partners_mirror?.id ?? null,
        firm_name: row.partners_mirror?.investors_mirror?.firm_name ?? null,
        partner_name: row.partners_mirror?.name ?? null,
        status_code: row.status_code,
        reason: threshold.reason(idleDays),
        idle_days: idleDays,
      });
    }
    // Longest-idle first so the most urgent row shows at the top.
    needsAttention.sort((a, b) => b.idle_days - a.idle_days);
  } else {
    console.error(
      "getTrackerActionPanel attention fetch failed:",
      attentionResult.error.message,
    );
  }

  return {
    pendingApprovalCount,
    recentEvents,
    needsAttention,
  };
}

/**
 * Best-effort relative-time label — "3h ago", "2d ago", "just now".
 * Stable across locales; deliberately lightweight (no Intl.RelativeTime
 * formatter) so it renders identically on server and client.
 */
export function relativeTimeLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "recently";
  const diffMs = Math.max(0, now - then);
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
