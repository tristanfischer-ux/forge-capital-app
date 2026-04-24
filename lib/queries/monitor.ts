import { createServerClient } from "@/lib/supabase/server";

/**
 * Campaign monitor data — the Step 10 "Monitor" tile for the
 * /send/[campaignId] flow. After the founder queues sends in Step 9
 * this surface answers the one question that actually matters:
 * "what happened?" — how many went out, how many are still pending,
 * how many failed, how many bounced, and who has replied in the last
 * seven days.
 *
 * Everything is scoped to a single campaign via the
 * scheduled_sends → campaign_partners join (scheduled_sends carries
 * campaign_partner_id, not campaign_id directly). contact_events and
 * campaign_partners-bounce lookups share the same join shape.
 *
 * Firm-name lookup is polymorphic (migration 030): a partner is
 * either kind='investor' with investor_id set, or kind='customer'
 * with customer_id set — never both. We select both joined rows and
 * coalesce investors_mirror.firm_name ?? customers_mirror.firm_name
 * so downstream rendering never needs to care about the
 * discriminator. Mirrors the pattern already used in approval.ts +
 * customer-partners.ts.
 */

export interface CampaignMonitorData {
  counts: {
    /** scheduled_sends rows with status='sent' for this campaign. */
    sent: number;
    /** scheduled_sends rows with status='pending' — waiting for the dispatcher. */
    queued: number;
    /** scheduled_sends rows with status='dispatching' — daemon has claimed. */
    dispatching: number;
    /** scheduled_sends rows with status='failed' — Gmail rejected or deliverability check failed. */
    failed: number;
    /** scheduled_sends rows with status='cancelled' — founder cancelled before dispatch. */
    cancelled: number;
    /** contact_events direction='inbound' in the last 7 days, scoped to this campaign. */
    inbound_replies_7d: number;
    /** campaign_partners with status_code='-2' (bounced) updated in the last 7 days. */
    bounces_7d: number;
  };
  recent: CampaignMonitorEvent[];
}

export interface CampaignMonitorEvent {
  kind: "send" | "failed" | "reply" | "bounce";
  at: string;
  firm_name: string | null;
  partner_name: string | null;
  partner_title: string | null;
  /** Subject line of the sent email — populated for kind='send'. */
  subject: string | null;
  /** Error message — populated for kind='failed'. */
  error_message: string | null;
  /** Short summary of the event — populated for kind='reply' (from contact_events.summary). */
  summary: string | null;
  campaign_partner_id: string;
}

/**
 * Shape of each row returned by the scheduled_sends + nested partner
 * joins. Kept as a local type so the select strings stay aligned with
 * the declared shape. `partners_mirror` is a single row, not an array
 * (FK is one-to-one via partner_id), but PostgREST's TypeScript
 * inference mis-typed these as arrays before migration 030 — we cast
 * via `unknown` and narrow here.
 */
interface ScheduledSendRow {
  id: string;
  status: string;
  subject: string | null;
  sent_at: string | null;
  created_at: string | null;
  error_message: string | null;
  campaign_partner_id: string;
  campaign_partners: {
    id: string;
    partners_mirror: {
      name: string | null;
      title: string | null;
      kind: string | null;
      investors_mirror: { firm_name: string | null } | null;
      customers_mirror: { firm_name: string | null } | null;
    } | null;
  } | null;
}

interface InboundReplyRow {
  id: string;
  event_at: string;
  summary: string | null;
  campaign_partner_id: string;
  campaign_partners: {
    id: string;
    partners_mirror: {
      name: string | null;
      title: string | null;
      kind: string | null;
      investors_mirror: { firm_name: string | null } | null;
      customers_mirror: { firm_name: string | null } | null;
    } | null;
  } | null;
}

interface BounceRow {
  id: string;
  status_code: string | null;
  created_at: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    title: string | null;
    kind: string | null;
    investors_mirror: { firm_name: string | null } | null;
    customers_mirror: { firm_name: string | null } | null;
  } | null;
}

function coalesceFirmName(partner: {
  kind: string | null;
  investors_mirror: { firm_name: string | null } | null;
  customers_mirror: { firm_name: string | null } | null;
} | null): string | null {
  if (!partner) return null;
  if (partner.kind === "customer") return partner.customers_mirror?.firm_name ?? null;
  return partner.investors_mirror?.firm_name ?? null;
}

export async function getCampaignMonitor(
  campaignId: string,
): Promise<CampaignMonitorData> {
  const empty: CampaignMonitorData = {
    counts: {
      sent: 0,
      queued: 0,
      dispatching: 0,
      failed: 0,
      cancelled: 0,
      inbound_replies_7d: 0,
      bounces_7d: 0,
    },
    recent: [],
  };
  if (!campaignId) return empty;

  const supabase = await createServerClient();
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ── 1. scheduled_sends counts + recent sent/failed rows ────────────
  // Join scheduled_sends → campaign_partners (inner) filtered by
  // campaign_id. PostgREST's `campaign_partners!inner` forces an inner
  // join so the .eq("campaign_partners.campaign_id", …) filter can
  // narrow the set. We also pull the nested partner joins so the
  // "Recent activity" rows have firm + contact without a second round
  // trip.
  const sendsSelect = `
    id, status, subject, sent_at, created_at, error_message, campaign_partner_id,
    campaign_partners:campaign_partner_id!inner (
      id,
      partners_mirror:partner_id (
        name, title, kind,
        investors_mirror:investor_id ( firm_name ),
        customers_mirror:customer_id ( firm_name )
      )
    )
  `;

  const { data: sendsData, error: sendsError } = await supabase
    .from("scheduled_sends")
    .select(sendsSelect)
    .eq("campaign_partners.campaign_id", campaignId)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (sendsError) {
    console.error("getCampaignMonitor scheduled_sends failed:", sendsError.message);
  }

  const sendsRows = (sendsData ?? []) as unknown as ScheduledSendRow[];

  let sent = 0;
  let queued = 0;
  let dispatching = 0;
  let failed = 0;
  let cancelled = 0;
  const sendEvents: CampaignMonitorEvent[] = [];
  const failedEvents: CampaignMonitorEvent[] = [];

  for (const row of sendsRows) {
    switch (row.status) {
      case "sent":
        sent += 1;
        if (row.sent_at) {
          const partner = row.campaign_partners?.partners_mirror ?? null;
          sendEvents.push({
            kind: "send",
            at: row.sent_at,
            firm_name: coalesceFirmName(partner),
            partner_name: partner?.name ?? null,
            partner_title: partner?.title ?? null,
            subject: row.subject,
            error_message: null,
            summary: null,
            campaign_partner_id: row.campaign_partner_id,
          });
        }
        break;
      case "pending":
        queued += 1;
        break;
      case "dispatching":
        dispatching += 1;
        break;
      case "failed": {
        failed += 1;
        const partner = row.campaign_partners?.partners_mirror ?? null;
        failedEvents.push({
          kind: "failed",
          at: row.sent_at ?? row.created_at ?? new Date(0).toISOString(),
          firm_name: coalesceFirmName(partner),
          partner_name: partner?.name ?? null,
          partner_title: partner?.title ?? null,
          subject: row.subject,
          error_message: row.error_message,
          summary: null,
          campaign_partner_id: row.campaign_partner_id,
        });
        break;
      }
      case "cancelled":
        cancelled += 1;
        break;
      default:
        // Unknown status — ignore for counts. Surfacing would require a
        // new UI bucket; we don't silently lose data, the row still
        // exists in scheduled_sends for /approval/scheduled to show.
        break;
    }
  }

  // ── 2. Inbound replies in last 7 days ──────────────────────────────
  const repliesSelect = `
    id, event_at, summary, campaign_partner_id,
    campaign_partners:campaign_partner_id!inner (
      id,
      partners_mirror:partner_id (
        name, title, kind,
        investors_mirror:investor_id ( firm_name ),
        customers_mirror:customer_id ( firm_name )
      )
    )
  `;
  const { data: repliesData, error: repliesError } = await supabase
    .from("contact_events")
    .select(repliesSelect)
    .eq("direction", "inbound")
    .eq("campaign_partners.campaign_id", campaignId)
    .gt("event_at", sevenDaysAgo)
    .order("event_at", { ascending: false })
    .limit(50);

  if (repliesError) {
    console.error("getCampaignMonitor inbound replies failed:", repliesError.message);
  }

  const replyRows = (repliesData ?? []) as unknown as InboundReplyRow[];
  const replyEvents: CampaignMonitorEvent[] = replyRows.map((row) => {
    const partner = row.campaign_partners?.partners_mirror ?? null;
    return {
      kind: "reply",
      at: row.event_at,
      firm_name: coalesceFirmName(partner),
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      subject: null,
      error_message: null,
      summary: row.summary,
      campaign_partner_id: row.campaign_partner_id,
    };
  });
  const inboundReplies7d = replyEvents.length;

  // ── 3. Bounces in last 7 days (campaign_partners.status_code = -2) ──
  const bouncesSelect = `
    id, status_code, created_at, last_contact_at,
    partners_mirror:partner_id (
      name, title, kind,
      investors_mirror:investor_id ( firm_name ),
      customers_mirror:customer_id ( firm_name )
    )
  `;
  const { data: bouncesData, error: bouncesError } = await supabase
    .from("campaign_partners")
    .select(bouncesSelect)
    .eq("campaign_id", campaignId)
    .eq("status_code", "-2")
    .gt("last_contact_at", sevenDaysAgo)
    .order("last_contact_at", { ascending: false })
    .limit(50);

  if (bouncesError) {
    console.error("getCampaignMonitor bounces failed:", bouncesError.message);
  }

  const bounceRows = (bouncesData ?? []) as unknown as BounceRow[];
  const bounceEvents: CampaignMonitorEvent[] = bounceRows.map((row) => {
    const partner = row.partners_mirror ?? null;
    return {
      kind: "bounce",
      at: row.last_contact_at ?? row.created_at ?? new Date(0).toISOString(),
      firm_name: coalesceFirmName(partner),
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      subject: null,
      error_message: null,
      summary: "Email bounced — address likely invalid.",
      campaign_partner_id: row.id,
    };
  });
  const bounces7d = bounceEvents.length;

  // ── 4. Merge recent events across sources, sort desc, trim to 20 ───
  const recent = [
    ...sendEvents,
    ...failedEvents,
    ...replyEvents,
    ...bounceEvents,
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 20);

  return {
    counts: {
      sent,
      queued,
      dispatching,
      failed,
      cancelled,
      inbound_replies_7d: inboundReplies7d,
      bounces_7d: bounces7d,
    },
    recent,
  };
}
