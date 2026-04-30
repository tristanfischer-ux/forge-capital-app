"use server";

import { createServerClient } from "@/lib/supabase/server";
import { sendGmailMessage } from "@/lib/gmail/create-draft";
import { labelFor, STATUS_CODES } from "@/lib/status-codes";
import { isSelfManaged } from "@/lib/queries/self-managed";

/**
 * Weekly founder digest — BACKLOG.md Level 6.
 *
 * Once a week (Monday 07:00 BST via launchd) Tristan gets a per-campaign
 * plain-text email summarising the last 7 days. The email is intentionally
 * plain text — per the UX audit Tristan prefers plain over HTML for these
 * kinds of digests, and it's what email clients render most predictably on
 * mobile without image warnings or font scaling quirks.
 *
 * This file exposes:
 *   - generateWeeklyDigest({campaignId}) — pure read, returns
 *     { subject, body, stats }. Used by the /weekly-digest preview page
 *     and by scripts/weekly-digest-cron.mjs.
 *   - sendWeeklyDigestToMe({campaignId}) — calls generate + sendGmailMessage
 *     to the authed user's own gmail_tokens.email row.
 *
 * Data sources (NO new tables):
 *   - contact_events: per-direction / per-event_type counts over the
 *     last 7 days; replies classified by a lightweight keyword check on
 *     event.summary when available; otherwise counted as "neutral".
 *   - campaign_partners: current status_code distribution and
 *     needs-follow-up detection (rows at +6 or later with no subsequent
 *     outbound in > 5 days, rows at +3 silent > 7 days).
 *   - contact_events.follow_up_due_at (migration 024): upcoming
 *     follow-ups in the next 7 days.
 *
 * Plain-text body structure — see BACKLOG.md Level 6 prompt. Fixed
 * column width: no lines exceed 78 characters; bullets use "* " (a
 * plain asterisk) rather than a UTF-8 dot so Mac Mail doesn't mojibake
 * the way the audit-resend run did (send-test-email.mjs comment §1).
 */

export type WeeklyDigestStats = {
  sent: number;
  replies: number;
  repliesPositive: number;
  repliesNegative: number;
  repliesNeutral: number;
  meetings_booked: number;
  silent_over_7d: number;
  handovers: number;
  declines: number;
};

export type GenerateWeeklyDigestResult =
  | {
      ok: true;
      subject: string;
      body: string;
      stats: WeeklyDigestStats;
    }
  | { ok: false; error: string };

export type SendWeeklyDigestResult =
  | { ok: true; to: string; subject: string; gmailMessageId: string }
  | { ok: false; error: string };

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Status-code groups for the digest's signalling logic. Keep in sync
// with lib/status-codes.ts — +6 "Response received" onwards is where
// Tristan expects the conversation to advance and silence is material.
const POST_REPLY_CODES = ["+6", "+7", "+8", "+9", "+10", "+11", "+12"] as const;

/** Light classification on the reply's event.summary text. The Gmail
 *  sync writes the subject/snippet into summary. We keep this dumb on
 *  purpose — "positive" = contains one of the yes/meeting words,
 *  "negative" = contains a polite-no word, else "neutral". Agents
 *  hunting smarter classification should not do it here; put it in
 *  contact_events via Opus synthesis instead. */
function classifyReplyTone(
  summary: string | null | undefined,
): "positive" | "negative" | "neutral" {
  if (!summary) return "neutral";
  const s = summary.toLowerCase();
  const positive = [
    "happy to",
    "keen to",
    "sounds good",
    "let's set",
    "book a call",
    "schedule",
    "interested",
    "love to chat",
    "great — ",
    "yes, ",
    "meeting",
  ];
  const negative = [
    "not a fit",
    "not for us",
    "passing for now",
    "out of scope",
    "politely decline",
    "no thanks",
    "unfortunately",
    "not investing",
    "not the right",
    "don't invest",
  ];
  if (positive.some((p) => s.includes(p))) return "positive";
  if (negative.some((p) => s.includes(p))) return "negative";
  return "neutral";
}

/** Format an ISO date as a short "Mon 28 Apr" label. */
function shortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/London",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Monday-anchored "week of" label for the subject line. */
function weekOfLabel(now: Date): string {
  // Compute Monday of the current ISO week in Europe/London.
  // We pivot via UTC for determinism; a ±1h DST wobble on the Monday
  // label doesn't matter — it still says "Mon 28 Apr".
  const d = new Date(now.getTime());
  const dayIdx = (d.getUTCDay() + 6) % 7; // 0 = Mon
  const monday = new Date(d.getTime() - dayIdx * MS_PER_DAY);
  return shortDate(monday.toISOString());
}

interface CampaignRow {
  id: string;
  name: string;
  campaign_intent: string;
  status: string;
  counterpart_email: string | null;
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

interface EventRow {
  id: string;
  campaign_partner_id: string;
  direction: string | null;
  event_type: string | null;
  event_at: string;
  summary: string | null;
  follow_up_due_at: string | null;
  follow_up_done_at: string | null;
  title: string | null;
}

function wrap(label: string, value: string | number): string {
  return `${label}: ${value}`;
}

function firmFor(row: PartnerJoinRow): string {
  return row.partners_mirror?.investors_mirror?.firm_name ?? "(unknown firm)";
}

export async function generateWeeklyDigest(input: {
  campaignId: string;
}): Promise<GenerateWeeklyDigestResult> {
  const { campaignId } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();

  const { data: campaignData, error: campaignErr } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent, status, counterpart_email")
    .eq("id", campaignId)
    .single();
  if (campaignErr || !campaignData) {
    return { ok: false, error: `campaign fetch failed: ${campaignErr?.message ?? "not found"}` };
  }
  const campaign = campaignData as unknown as CampaignRow;

  // Self-managed campaigns (no external counterpart) have no "company
  // side" to hand over to — suppress handover bullet in HEADLINE.
  // campaign_intent drives noun plural choice throughout body copy
  // (investors / customers / suppliers). 2026-04-23 Fischer Farms
  // Customer case flagged the vocabulary gap.
  const selfManaged = isSelfManaged(campaign);
  const nounPlural =
    (
      {
        investor: "investors",
        customer: "customers",
        supplier: "suppliers",
      } as const
    )[campaign.campaign_intent as "investor" | "customer" | "supplier"] ??
    "partners";
  const replyNoun =
    (
      {
        investor: "investor replies",
        customer: "customer replies",
        supplier: "supplier replies",
      } as const
    )[campaign.campaign_intent as "investor" | "customer" | "supplier"] ??
    "replies";
  // nounPlural is declared for any future "investors surfaced / customers
  // contacted" phrasing the digest may grow; replyNoun is used in the
  // HEADLINE section. Silence unused-var lint for nounPlural.
  void nounPlural;

  // Pull every partner row for the campaign.
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
    return { ok: false, error: `partners fetch failed: ${partnersErr.message}` };
  }
  const partners = (partnersData ?? []) as unknown as PartnerJoinRow[];
  const partnerIds = partners.map((p) => p.id);
  const partnersById = new Map(partners.map((p) => [p.id, p] as const));

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * MS_PER_DAY);
  const upcomingEnd = new Date(now.getTime() + 7 * MS_PER_DAY);

  // Pull 14 days of contact_events for this campaign's partners so we
  // have enough context to detect "last outbound > 5 days ago" on +6+
  // rows. Cap by partnerIds to stay within RLS and payload sanity.
  let events: EventRow[] = [];
  if (partnerIds.length > 0) {
    const fourteenAgo = new Date(now.getTime() - 14 * MS_PER_DAY);
    const { data: evData, error: evErr } = await supabase
      .from("contact_events")
      .select(
        "id, campaign_partner_id, direction, event_type, event_at, summary, follow_up_due_at, follow_up_done_at, title",
      )
      .in("campaign_partner_id", partnerIds)
      .gte("event_at", fourteenAgo.toISOString())
      .order("event_at", { ascending: false });
    if (evErr) {
      return { ok: false, error: `events fetch failed: ${evErr.message}` };
    }
    events = (evData ?? []) as unknown as EventRow[];
  }

  // -------- Headline counts --------
  const inLast7 = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= windowStart.getTime() && t <= now.getTime();
  };

  // "First-contacts sent" in the week: outbound events whose event_type
  // is "sent" (Gmail sync writes this). Other outbound rows (e.g. manual
  // follow-up logged through CRM) are folded in as well — Tristan cares
  // about throughput here.
  const sentEvents = events.filter(
    (e) => inLast7(e.event_at) && e.direction === "outbound",
  );

  const replyEvents = events.filter(
    (e) => inLast7(e.event_at) && e.direction === "inbound",
  );
  let repliesPositive = 0;
  let repliesNegative = 0;
  let repliesNeutral = 0;
  for (const e of replyEvents) {
    const tone = classifyReplyTone(e.summary);
    if (tone === "positive") repliesPositive += 1;
    else if (tone === "negative") repliesNegative += 1;
    else repliesNeutral += 1;
  }

  // Meetings booked: contact_events with event_type 'meeting' OR
  // direction 'meeting'. V1's event_type vocabulary isn't rigid — we
  // match either shape so calendar-sync (writes direction='meeting')
  // and CRM-synthesis (writes event_type='meeting_scheduled') both
  // count. Window: last 7d OR next 7d (meetings held recently + ones
  // booked forward).
  const meetingEvents = events.filter((e) => {
    const isMeeting =
      e.direction === "meeting" ||
      e.event_type === "meeting" ||
      e.event_type === "meeting_scheduled" ||
      e.event_type === "meeting_held";
    if (!isMeeting) return false;
    const t = new Date(e.event_at).getTime();
    return t >= windowStart.getTime() && t <= upcomingEnd.getTime();
  });
  // Dedupe meetings per campaign_partner — one meeting row per firm.
  const meetingsByPartner = new Map<string, EventRow>();
  for (const e of meetingEvents) {
    const existing = meetingsByPartner.get(e.campaign_partner_id);
    if (!existing) meetingsByPartner.set(e.campaign_partner_id, e);
  }

  // Needs follow-up: partners at +6 (Response received) or later with
  // no outbound event in > 5 days. Gives Tristan the list of live
  // conversations he's been silent on.
  const latestOutboundByPartner = new Map<string, string>(); // partner_id -> event_at
  for (const e of events) {
    if (e.direction !== "outbound") continue;
    const existing = latestOutboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      latestOutboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }
  const needsFollowUp: PartnerJoinRow[] = [];
  for (const p of partners) {
    if (!p.status_code) continue;
    if (!POST_REPLY_CODES.includes(p.status_code as (typeof POST_REPLY_CODES)[number])) continue;
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) {
      needsFollowUp.push(p);
      continue;
    }
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days > 5) needsFollowUp.push(p);
  }

  // Silent over 7d at +3 (Email sent): partners with status_code +3 and
  // no inbound in the last 7 days. These are the cold first-contacts.
  const inboundByPartner = new Map<string, string>();
  for (const e of events) {
    if (e.direction !== "inbound") continue;
    const existing = inboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      inboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }
  const silentOver7d: PartnerJoinRow[] = [];
  for (const p of partners) {
    if (p.status_code !== "+3") continue;
    const lastIn = inboundByPartner.get(p.id);
    if (lastIn && new Date(lastIn).getTime() > windowStart.getTime()) continue;
    // Must have had an outbound >= 7 days ago to qualify as "silent over 7d".
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) continue;
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days >= 7) silentOver7d.push(p);
  }

  // Handovers: events tagged event_type='handover' in the last 7 days.
  // No dedicated column yet; Tristan logs handovers via the CRM entry
  // form and the event_type is a free-text convention. If zero rows
  // carry the type the tile shows 0 honestly.
  const handoverEvents = events.filter(
    (e) => inLast7(e.event_at) && e.event_type === "handover",
  );
  const handoverPartnerIds = new Set(
    handoverEvents.map((e) => e.campaign_partner_id),
  );
  const handoverPartners = partners.filter((p) => handoverPartnerIds.has(p.id));

  // Declines: partners at -1 whose last_contact_at is within the week.
  const declinePartners = partners.filter(
    (p) => p.status_code === "-1" && p.last_contact_at && inLast7(p.last_contact_at),
  );

  // Upcoming follow-ups in the next 7 days (from contact_events.follow_up_due_at,
  // undone only).
  const upcomingFollowUps = events
    .filter(
      (e) =>
        e.follow_up_due_at &&
        !e.follow_up_done_at &&
        new Date(e.follow_up_due_at).getTime() >= now.getTime() &&
        new Date(e.follow_up_due_at).getTime() <= upcomingEnd.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.follow_up_due_at!).getTime() - new Date(b.follow_up_due_at!).getTime(),
    );

  // Status distribution: full +12..-3 in declared order.
  const distribution = new Map<string, number>();
  for (const s of STATUS_CODES) distribution.set(s.code, 0);
  for (const p of partners) {
    if (p.status_code && distribution.has(p.status_code)) {
      distribution.set(p.status_code, (distribution.get(p.status_code) ?? 0) + 1);
    }
  }

  const stats: WeeklyDigestStats = {
    sent: sentEvents.length,
    replies: replyEvents.length,
    repliesPositive,
    repliesNegative,
    repliesNeutral,
    meetings_booked: meetingsByPartner.size,
    silent_over_7d: silentOver7d.length,
    handovers: handoverPartners.length,
    declines: declinePartners.length,
  };

  // -------- Build the email --------
  const weekLabel = weekOfLabel(now);
  const subject = `[DIGEST] ${campaign.name} - week of ${weekLabel}: ${stats.sent} sent, ${stats.replies} replies, ${stats.meetings_booked} meetings`;

  const lines: string[] = [];
  lines.push("Hi,");
  lines.push("");
  lines.push(
    `Here's what happened on ${campaign.name} in the last 7 days.`,
  );
  lines.push("");

  // HEADLINE section
  lines.push("HEADLINE");
  lines.push(`* ${stats.sent} first-contacts sent`);
  lines.push(
    `* ${stats.replies} ${replyNoun} received (${repliesPositive} positive, ${repliesNegative} negative, ${repliesNeutral} neutral)`,
  );

  if (meetingsByPartner.size === 0) {
    lines.push(`* 0 meetings booked`);
  } else {
    const meetingLines: string[] = [];
    for (const [partnerId, ev] of meetingsByPartner.entries()) {
      const partner = partnersById.get(partnerId);
      const firm = partner ? firmFor(partner) : "(unknown firm)";
      meetingLines.push(`${firm} (${shortDate(ev.event_at)})`);
    }
    lines.push(
      `* ${stats.meetings_booked} meetings booked: ${meetingLines.join("; ")}`,
    );
  }

  // Handover bullet is only meaningful for multi-party campaigns where
  // a counterpart owns warm replies. In self-managed campaigns there is
  // no "company" to hand over to, so the line is omitted entirely.
  if (!selfManaged) {
    if (handoverPartners.length === 0) {
      lines.push(`* 0 handed over to the company`);
    } else {
      const firms = handoverPartners.map((p) => firmFor(p)).join(", ");
      lines.push(
        `* ${handoverPartners.length} handed over to the company: ${firms}`,
      );
    }
  }

  if (declinePartners.length > 0) {
    const firms = declinePartners.map((p) => firmFor(p)).join(", ");
    lines.push(`* ${declinePartners.length} declined this week: ${firms}`);
  }
  lines.push("");

  // NEEDS YOUR ATTENTION
  lines.push("NEEDS YOUR ATTENTION");
  if (needsFollowUp.length === 0 && silentOver7d.length === 0) {
    lines.push(
      "No stuck conversations. Nothing at +6 or later has been silent for more than 5 days.",
    );
  } else {
    if (needsFollowUp.length > 0) {
      for (const p of needsFollowUp.slice(0, 20)) {
        const firm = firmFor(p);
        const statusLabel = labelFor(p.status_code) ?? "";
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : null;
        const tail = days === null ? "no outbound logged" : `${days}d since last outbound`;
        lines.push(
          `* ${firm} [${p.status_code} ${statusLabel}] - ${tail}`,
        );
      }
      if (needsFollowUp.length > 20) {
        lines.push(`... and ${needsFollowUp.length - 20} more`);
      }
    }
    if (silentOver7d.length > 0) {
      lines.push("");
      lines.push(`Silent over 7 days at +3 (no reply since first contact):`);
      for (const p of silentOver7d.slice(0, 20)) {
        const firm = firmFor(p);
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : 7;
        lines.push(`* ${firm} - ${days}d silent`);
      }
      if (silentOver7d.length > 20) {
        lines.push(`... and ${silentOver7d.length - 20} more`);
      }
    }
  }
  lines.push("");

  // UPCOMING FOLLOW-UPS
  lines.push("UPCOMING FOLLOW-UPS (next 7 days)");
  if (upcomingFollowUps.length === 0) {
    lines.push("No follow-ups scheduled. Log a follow-up from any tracker row to populate this.");
  } else {
    for (const ev of upcomingFollowUps.slice(0, 20)) {
      const partner = partnersById.get(ev.campaign_partner_id);
      const firm = partner ? firmFor(partner) : "(unknown firm)";
      const due = shortDate(ev.follow_up_due_at!);
      const titleTail = ev.title ? ` - ${ev.title}` : "";
      lines.push(`* ${due}: ${firm}${titleTail}`);
    }
    if (upcomingFollowUps.length > 20) {
      lines.push(`... and ${upcomingFollowUps.length - 20} more`);
    }
  }
  lines.push("");

  // STATUS DISTRIBUTION (full 16-code line). Omit codes with zero to
  // keep the line readable.
  lines.push("STATUS DISTRIBUTION");
  const distLine = STATUS_CODES.map((s) => ({ code: s.code, n: distribution.get(s.code) ?? 0 }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.code}: ${x.n}`)
    .join(" * ");
  lines.push(distLine.length > 0 ? distLine : "No partners on this campaign yet.");
  lines.push("");

  lines.push("-- auto-generated by forge-capital-app. Reply to mark done.");

  // Use _wrap to silence lint if not used elsewhere (kept for readability).
  void wrap;

  return {
    ok: true,
    subject,
    body: lines.join("\n"),
    stats,
  };
}

/**
 * Convenience: generate + send to the authed user's own Gmail address
 * (from gmail_tokens.email). Button on /weekly-digest calls this.
 */
export async function sendWeeklyDigestToMe(input: {
  campaignId: string;
}): Promise<SendWeeklyDigestResult> {
  const digest = await generateWeeklyDigest(input);
  if (!digest.ok) return { ok: false, error: digest.error };

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "not signed in" };

  const { data: token, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select("email")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (tokenErr || !token?.email) {
    return {
      ok: false,
      error:
        "Gmail not connected — connect Gmail from /settings before sending the digest.",
    };
  }

  try {
    const res = await sendGmailMessage({
      to: token.email,
      subject: digest.subject,
      body: digest.body,
    });

    // Log the send to weekly_digest_log (migration 034) for the history
    // section on /weekly. Non-fatal — never block the confirmation.
    void supabase.from("weekly_digest_log").insert({
      campaign_id: input.campaignId,
      digest_type: "founder_digest",
      to_email: token.email,
      subject: digest.subject,
      body_preview: digest.body.slice(0, 300),
      gmail_message_id: res.id,
      created_by: auth.user.id,
    });

    return {
      ok: true,
      to: token.email,
      subject: digest.subject,
      gmailMessageId: res.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `gmail send failed: ${msg}` };
  }
}
