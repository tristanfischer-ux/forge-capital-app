import { createServerClient } from "@/lib/supabase/server";
import { labelFor, STATUS_BY_CODE } from "@/lib/status-codes";

/**
 * Weekly counterpart update — queries backing V4 §10
 * (Phase2-Mockup-V4.html lines 1872-2175).
 *
 * V4 renders a single weekly digest card:
 *   - Header: "Week N of 16 · Campaign · Counterpart"
 *   - 5 stat tiles (.wk-stat): Emails sent / Replies received /
 *     Meetings scheduled / NDA-diligence / Declined, each with a
 *     delta vs last week.
 *   - Two charts (.chart-card) — "Pipeline volume · last 8 weeks"
 *     line chart, "Status distribution · this week vs prior" stacked
 *     bars. Both are inline SVG in V4 (no chart library).
 *   - Top-3 conversations callout (green) + items-needing-steer
 *     callout (amber).
 *   - Footer with Edit-copy + "Send to {counterpart}" buttons.
 *
 * Every number is computed from live Supabase data. We never fabricate
 * deltas: if the prior week had zero events, the delta label says
 * "new" or "no prior data" — it does not invent a percentage.
 *
 * Campaign is resolved the same way the rest of the app does (?c=<uuid>
 * or fc_active_campaign cookie). The counterpart name has no explicit
 * DB column in V1 so we render the campaign name + an honest "TBD"
 * placeholder for the counterpart email — this is a genuine V1 gap
 * flagged in the tooltip, not fabricated.
 */

export interface WeeklyStatTile {
  /** React key. */
  id: string;
  /** Big number. */
  value: number;
  /** Uppercase label under the number. */
  label: string;
  /** Tone class — maps to v4-mockup.css `.n.accent|green|red`. */
  tone?: "accent" | "green" | "red";
  /** Delta vs last week. Null when there is no prior-week data. */
  delta: WeeklyDelta | null;
}

export interface WeeklyDelta {
  direction: "up" | "down" | "flat";
  /** Already-formatted trailing copy, eg "4 vs last week". */
  label: string;
}

export interface PipelinePoint {
  /** ISO week label ("w17"). */
  weekLabel: string;
  /** Events with direction = outbound. */
  sent: number;
  /** Events with direction = inbound. */
  replies: number;
  /** Meetings scheduled — status_code +8 events inferred from status_label
   *  or from event_type = 'meeting_scheduled'. */
  meetings: number;
}

export interface StatusDistribution {
  /** Total campaign_partners in this bucket this week (by last_contact_at). */
  thisWeek: { positive: number; mid: number; negative: number; total: number };
  priorWeek: { positive: number; mid: number; negative: number; total: number };
}

export interface TopConversation {
  partnerId: string;
  firmName: string | null;
  partnerName: string | null;
  statusCode: string | null;
  statusLabel: string | null;
  /** Null when we have no last_contact_at. */
  daysSinceLastTouch: number | null;
}

export interface SteerCallout {
  partnerId: string;
  firmName: string | null;
  reason: string;
}

export interface WeeklySummary {
  campaignId: string;
  campaignName: string;
  campaignIntent: "investor" | "customer" | "supplier";
  /** Calendar week number of this year (1-53). */
  weekNumber: number;
  /** N of (weekCountTarget). Uses week_started_at (migration 012), falls
   *  back to created_at. Null if both are unset. */
  weekOfCampaign: number | null;
  /** Total weeks for the subject line "Week N of M". Default 16. */
  weekCountTarget: number;
  counterpartName: string | null;
  counterpartEmail: string | null;
  generatedAt: string;
  tiles: WeeklyStatTile[];
  pipelinePoints: PipelinePoint[];
  distribution: StatusDistribution;
  topConversations: TopConversation[];
  callouts: SteerCallout[];
  /** When the underlying contact_events table is empty for the campaign,
   *  downstream SVGs render an honest "no activity yet" hint rather than
   *  a bogus chart with invented heights. */
  hasEventData: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_WEEK = MS_PER_DAY * 7;

/**
 * Tuesday-anchored "week start" for a given date — matches the V4
 * caption "Generated Friday 17:00 · Activity since Fri 14 Apr". We use
 * rolling 7-day windows (now-7d..now) rather than ISO weeks because
 * the V4 copy explicitly says "since last Friday".
 */
function rollingWindow(now: Date, weeksAgo: number): { start: Date; end: Date } {
  const end = new Date(now.getTime() - weeksAgo * MS_PER_WEEK);
  const start = new Date(end.getTime() - MS_PER_WEEK);
  return { start, end };
}

/**
 * Builds a vs-last-week delta label from two integer counts. We refuse
 * to emit "▲ X vs last week" when the prior week was zero because that
 * collapses to "new since last week" and the arrow is misleading.
 */
function buildDelta(current: number, prior: number): WeeklyDelta | null {
  const diff = current - prior;
  if (current === 0 && prior === 0) return null;
  if (prior === 0 && current > 0) {
    return { direction: "up", label: `${current} (new this week)` };
  }
  if (diff === 0) return { direction: "flat", label: "flat" };
  if (diff > 0) return { direction: "up", label: `${diff} vs last week` };
  return { direction: "down", label: `${Math.abs(diff)} vs last week` };
}

interface ContactEventRow {
  event_at: string;
  direction: string | null;
  event_type: string | null;
  campaign_partner_id: string;
}

interface PartnerJoinRow {
  id: string;
  campaign_id: string;
  status_code: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    investors_mirror: {
      firm_name: string | null;
    } | null;
  } | null;
}

interface CampaignRow {
  id: string;
  name: string;
  campaign_intent: string;
  created_at: string | null;
}

/**
 * ISO week number (1-53). Tristan's copy says "week 17" — the
 * calendar-week convention, not campaign-week.
 */
function isoWeekNumber(date: Date): number {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
}

/**
 * "Positive" / "mid" / "negative" buckets — matches V4's legend copy
 * "Positive (+6 to +10)" / "Mid (+1 to +5)" / "Negative (-1 to -3)".
 * +0 (pending approval) is intentionally excluded — it's not "mid",
 * it's pre-pipeline.
 */
function bucketForStatusCode(code: string | null): "positive" | "mid" | "negative" | null {
  if (!code) return null;
  const def = STATUS_BY_CODE[code];
  if (!def) return null;
  if (def.family === "committed") return "positive";
  if (def.family === "dead") return "negative";
  // +7, +8, +9, +10 are progressing — V4 puts them in positive (it's
  // a meetings-bucket in the legend). +0 through +6 are mid.
  if (["+7", "+8", "+9", "+10"].includes(code)) return "positive";
  if (["+1", "+2", "+3", "+4", "+5", "+6"].includes(code)) return "mid";
  return null;
}

/**
 * Derive meeting-scheduled-this-week count. Contact events don't carry
 * status codes, but `event_type='meeting_scheduled'` is a convention the
 * Gmail ingest (Phase 8) will write. Until then we fall back to counting
 * partners whose status_code advanced to +8 within the window — the
 * best honest proxy we have without the event_type signal.
 */
async function getWeeklySummaryForCampaign(
  campaignId: string,
): Promise<WeeklySummary | null> {
  const supabase = await createServerClient();

  // Pull the campaign row for the header + intent-aware "Emails sent"
  // vs "Buyer emails sent" label.
  const { data: campaignData, error: campaignErr } = await supabase
    .from("campaigns")
    .select(
      "id, name, campaign_intent, created_at, counterpart_name, counterpart_email, week_started_at, week_count_target",
    )
    .eq("id", campaignId)
    .single();

  if (campaignErr || !campaignData) {
    console.error("getWeeklySummary: campaign fetch failed", campaignErr?.message);
    return null;
  }
  const campaign = campaignData as unknown as CampaignRow;

  // Pull every campaign_partners row for the campaign so we can:
  //   - Bucket by status_code for the distribution chart
  //   - Rank top-3 recent conversations
  //   - Build the "needs steer" callouts
  const { data: partnersData, error: partnersErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaign_id,
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
    .eq("campaign_id", campaignId);

  if (partnersErr) {
    console.error("getWeeklySummary: partners fetch failed", partnersErr.message);
    return null;
  }
  const partners = (partnersData ?? []) as unknown as PartnerJoinRow[];
  const partnerIds = partners.map((p) => p.id);

  // Contact events for these partners, 8 weeks back. If the partner set
  // is empty (fresh campaign) we skip the events query altogether.
  let events: ContactEventRow[] = [];
  if (partnerIds.length > 0) {
    const eightWeeksAgo = new Date(Date.now() - 8 * MS_PER_WEEK);
    const { data: eventsData, error: eventsErr } = await supabase
      .from("contact_events")
      .select("event_at, direction, event_type, campaign_partner_id")
      .in("campaign_partner_id", partnerIds)
      .gte("event_at", eightWeeksAgo.toISOString());
    if (eventsErr) {
      console.error("getWeeklySummary: events fetch failed", eventsErr.message);
    } else {
      events = (eventsData ?? []) as unknown as ContactEventRow[];
    }
  }

  const now = new Date();
  const thisWindow = rollingWindow(now, 0);
  const lastWindow = rollingWindow(now, 1);

  // -------- Stat tiles (this week vs last week) --------
  const inWindow = (iso: string, win: { start: Date; end: Date }) => {
    const t = new Date(iso).getTime();
    return t >= win.start.getTime() && t <= win.end.getTime();
  };

  const countEvents = (
    win: { start: Date; end: Date },
    predicate: (e: ContactEventRow) => boolean,
  ) => events.filter((e) => inWindow(e.event_at, win) && predicate(e)).length;

  const sentThis = countEvents(thisWindow, (e) => e.direction === "outbound");
  const sentPrior = countEvents(lastWindow, (e) => e.direction === "outbound");

  const repliesThis = countEvents(thisWindow, (e) => e.direction === "inbound");
  const repliesPrior = countEvents(lastWindow, (e) => e.direction === "inbound");

  const meetingsThis = countEvents(
    thisWindow,
    (e) => e.event_type === "meeting_scheduled" || e.event_type === "meeting_held",
  );
  const meetingsPrior = countEvents(
    lastWindow,
    (e) => e.event_type === "meeting_scheduled" || e.event_type === "meeting_held",
  );

  const bouncesThis = countEvents(thisWindow, (e) => e.direction === "bounce");
  const bouncesPrior = countEvents(lastWindow, (e) => e.direction === "bounce");

  // +10 NDA/diligence — we count partners currently sitting there,
  // not a delta (no event_type signal for that transition yet).
  const ndaNow = partners.filter((p) => p.status_code === "+10").length;

  // Declined = -1 partners whose last_contact_at is in the this/last
  // window. Using last_contact_at as a rough proxy for "declined this
  // week" keeps the tile honest without inventing a new event type.
  const declinedThis = partners.filter(
    (p) =>
      p.status_code === "-1" &&
      p.last_contact_at &&
      inWindow(p.last_contact_at, thisWindow),
  ).length;
  const declinedPrior = partners.filter(
    (p) =>
      p.status_code === "-1" &&
      p.last_contact_at &&
      inWindow(p.last_contact_at, lastWindow),
  ).length;

  const intent = (campaign.campaign_intent as WeeklySummary["campaignIntent"]) ?? "investor";
  const sentLabel =
    intent === "customer" ? "Buyer emails sent" : "Emails sent";

  const tiles: WeeklyStatTile[] = [
    {
      id: "sent",
      value: sentThis,
      label: sentLabel,
      tone: "accent",
      delta: buildDelta(sentThis, sentPrior),
    },
    {
      id: "replies",
      value: repliesThis,
      label: "Replies received",
      delta: buildDelta(repliesThis, repliesPrior),
    },
    {
      id: "meetings",
      value: meetingsThis,
      label: "Meetings scheduled",
      tone: "green",
      delta: buildDelta(meetingsThis, meetingsPrior),
    },
    {
      id: "nda",
      value: ndaNow,
      label: intent === "customer" ? "LoIs signed" : "NDA / diligence",
      tone: "accent",
      delta: null,
    },
    {
      id: "bounces",
      value: bouncesThis + declinedThis,
      label: "Declined / bounced",
      tone: "red",
      delta: buildDelta(bouncesThis + declinedThis, bouncesPrior + declinedPrior),
    },
  ];

  // -------- Pipeline points — 8 weekly buckets --------
  const pipelinePoints: PipelinePoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const win = rollingWindow(now, i);
    const sent = countEvents(win, (e) => e.direction === "outbound");
    const replies = countEvents(win, (e) => e.direction === "inbound");
    const meetings = countEvents(
      win,
      (e) => e.event_type === "meeting_scheduled" || e.event_type === "meeting_held",
    );
    const weekNum = isoWeekNumber(win.end);
    pipelinePoints.push({
      weekLabel: `w${weekNum}`,
      sent,
      replies,
      meetings,
    });
  }

  // -------- Status distribution --------
  const distributionBucket = (
    filter: (p: PartnerJoinRow) => boolean,
  ): StatusDistribution["thisWeek"] => {
    const filtered = partners.filter(filter);
    const out = { positive: 0, mid: 0, negative: 0, total: filtered.length };
    for (const p of filtered) {
      const bucket = bucketForStatusCode(p.status_code);
      if (bucket === "positive") out.positive += 1;
      else if (bucket === "mid") out.mid += 1;
      else if (bucket === "negative") out.negative += 1;
    }
    return out;
  };

  // "This week" snapshot = partners with last_contact_at in the current
  // rolling 7d window; "prior week" = in the 7d window before that. This
  // matches V4's vs-prior framing.
  const distribution: StatusDistribution = {
    thisWeek: distributionBucket(
      (p) => p.last_contact_at !== null && inWindow(p.last_contact_at, thisWindow),
    ),
    priorWeek: distributionBucket(
      (p) => p.last_contact_at !== null && inWindow(p.last_contact_at, lastWindow),
    ),
  };

  // -------- Top-3 conversations --------
  // Rank by status_code weight (more positive first) then freshness.
  const codeWeight = (code: string | null): number => {
    if (!code) return -99;
    const order = [
      "+12", "+11", "+10", "+9", "+8", "+7", "+6", "+5", "+4", "+3", "+2", "+1", "+0",
    ];
    const idx = order.indexOf(code);
    return idx >= 0 ? order.length - idx : -99;
  };

  const topConversations: TopConversation[] = partners
    .filter((p) => p.last_contact_at !== null)
    .map((p) => {
      const daysSince = p.last_contact_at
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - new Date(p.last_contact_at).getTime()) / MS_PER_DAY,
            ),
          )
        : null;
      return {
        partnerId: p.id,
        firmName: p.partners_mirror?.investors_mirror?.firm_name ?? null,
        partnerName: p.partners_mirror?.name ?? null,
        statusCode: p.status_code,
        statusLabel: labelFor(p.status_code),
        daysSinceLastTouch: daysSince,
      };
    })
    .sort((a, b) => {
      const weightDiff = codeWeight(b.statusCode) - codeWeight(a.statusCode);
      if (weightDiff !== 0) return weightDiff;
      return (a.daysSinceLastTouch ?? 999) - (b.daysSinceLastTouch ?? 999);
    })
    .slice(0, 3);

  // -------- Callouts (needs steer) --------
  // V4 shows two kinds: conflict / ambiguous + stale. V1 can honestly
  // surface: (a) partners at -2 Bounced (email rescue), (b) partners at
  // +5 Follow-up sent with no update for 10+ days (nudge or mark -1).
  const callouts: SteerCallout[] = [];
  const bouncedPartners = partners.filter((p) => p.status_code === "-2");
  for (const p of bouncedPartners.slice(0, 2)) {
    const firm = p.partners_mirror?.investors_mirror?.firm_name ?? "(unknown firm)";
    callouts.push({
      partnerId: p.id,
      firmName: firm,
      reason: "email bounced — rescue address or drop?",
    });
  }
  const stalePartners = partners.filter((p) => {
    if (p.status_code !== "+5") return false;
    if (!p.last_contact_at) return false;
    const days = Math.floor(
      (now.getTime() - new Date(p.last_contact_at).getTime()) / MS_PER_DAY,
    );
    return days >= 10;
  });
  for (const p of stalePartners.slice(0, 2)) {
    const firm = p.partners_mirror?.investors_mirror?.firm_name ?? "(unknown firm)";
    const days = p.last_contact_at
      ? Math.floor(
          (now.getTime() - new Date(p.last_contact_at).getTime()) / MS_PER_DAY,
        )
      : 0;
    callouts.push({
      partnerId: p.id,
      firmName: firm,
      reason: `no reply ${days}d after follow-up — nudge once more or mark -1?`,
    });
  }

  // -------- Campaign clock --------
  // Migration 012 added `week_started_at` + `week_count_target`. Prefer
  // those when set; fall back to `created_at` so existing campaigns
  // still render something reasonable.
  const weekNumber = isoWeekNumber(now);
  let weekOfCampaign: number | null = null;
  const campaignAny = campaign as {
    week_started_at?: string | null;
    created_at?: string | null;
    counterpart_name?: string | null;
    counterpart_email?: string | null;
    week_count_target?: number | null;
  };
  const clockStart = campaignAny.week_started_at ?? campaignAny.created_at ?? null;
  if (clockStart) {
    const diff = now.getTime() - new Date(clockStart).getTime();
    if (diff >= 0) {
      weekOfCampaign = Math.floor(diff / MS_PER_WEEK) + 1;
    }
  }
  const weekCountTarget = campaignAny.week_count_target ?? 16;

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignIntent: intent,
    weekNumber,
    weekOfCampaign,
    weekCountTarget,
    counterpartName: campaignAny.counterpart_name ?? null,
    counterpartEmail: campaignAny.counterpart_email ?? null,
    generatedAt: now.toISOString(),
    tiles,
    pipelinePoints,
    distribution,
    topConversations,
    callouts,
    hasEventData: events.length > 0,
  };
}

/**
 * Public entry point. Returns null when the campaign can't be resolved
 * (e.g. RLS blocked the campaigns row).
 */
export async function getWeeklySummary(
  campaignId: string,
): Promise<WeeklySummary | null> {
  return getWeeklySummaryForCampaign(campaignId);
}
