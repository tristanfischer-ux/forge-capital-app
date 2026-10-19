/**
 * Origin/main weekly-digest builder (commit 7637a5e cron route), kept as a
 * test fixture for the doctor. Do not import this from app code.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const STATUS_CODES = [
  "+12",
  "+11",
  "+10",
  "+9",
  "+8",
  "+7",
  "+6",
  "+5",
  "+4",
  "+3",
  "+2",
  "+1",
  "+0",
  "-1",
  "-2",
  "-3",
];
const STATUS_LABELS: Record<string, string> = {
  "+12": "Committed",
  "+11": "Term sheet",
  "+10": "NDA / diligence",
  "+9": "Meeting held",
  "+8": "Meeting scheduled",
  "+7": "Meeting offered",
  "+6": "Response received",
  "+5": "Follow-up sent",
  "+4": "Auto-reply / OOO",
  "+3": "Email sent",
  "+2": "Drafted",
  "+1": "Approved",
  "+0": "Pending approval",
  "-1": "Declined",
  "-2": "Bounced",
  "-3": "Disqualified",
};
const POST_REPLY_CODES = ["+6", "+7", "+8", "+9", "+10", "+11", "+12"];

export type LegacyCampaign = {
  id: string;
  name: string;
  campaign_intent: string | null;
  counterpart_email: string | null;
};

export type LegacyPartner = {
  id: string;
  campaign_id: string;
  status_code: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name?: string;
    investors_mirror?: { firm_name?: string };
  } | null;
};

export type LegacyEvent = {
  id: string;
  campaign_partner_id: string;
  direction: string;
  event_type: string;
  event_at: string;
  summary: string | null;
  follow_up_due_at: string | null;
  follow_up_done_at: string | null;
  title: string | null;
};

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

function weekOfLabel(now: Date): string {
  const d = new Date(now.getTime());
  const dayIdx = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - dayIdx * MS_PER_DAY);
  return shortDate(monday.toISOString());
}

function classifyReplyTone(summary: unknown): "positive" | "negative" | "neutral" {
  if (!summary) return "neutral";
  const s = String(summary).toLowerCase();
  const pos = [
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
  const neg = [
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
  if (pos.some((p) => s.includes(p))) return "positive";
  if (neg.some((p) => s.includes(p))) return "negative";
  return "neutral";
}

function partnerNounPlural(intent: string | null): string {
  if (intent === "customer") return "customers";
  if (intent === "supplier") return "suppliers";
  return "investors";
}

function firmFor(p: LegacyPartner | undefined): string {
  return p?.partners_mirror?.investors_mirror?.firm_name ?? "(unknown firm)";
}

export function buildLegacyWeeklyDigest(input: {
  campaign: LegacyCampaign;
  partners: LegacyPartner[];
  events: LegacyEvent[];
  now: Date;
}): { subject: string; body: string; stats: Record<string, number> } {
  const { campaign, partners, events, now } = input;
  const selfManaged = !((campaign.counterpart_email ?? "").trim());
  const nounPlural = partnerNounPlural(campaign.campaign_intent);
  const partnersById = new Map(partners.map((p) => [p.id, p]));
  const windowStart = new Date(now.getTime() - 7 * MS_PER_DAY);
  const upcomingEnd = new Date(now.getTime() + 7 * MS_PER_DAY);

  const inLast7 = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= windowStart.getTime() && t <= now.getTime();
  };

  const sentEvents = events.filter((e) => inLast7(e.event_at) && e.direction === "outbound");
  const replyEvents = events.filter((e) => inLast7(e.event_at) && e.direction === "inbound");
  let repliesPositive = 0;
  let repliesNegative = 0;
  let repliesNeutral = 0;
  for (const e of replyEvents) {
    const tone = classifyReplyTone(e.summary);
    if (tone === "positive") repliesPositive++;
    else if (tone === "negative") repliesNegative++;
    else repliesNeutral++;
  }

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
  const meetingsByPartner = new Map<string, LegacyEvent>();
  for (const e of meetingEvents) {
    if (!meetingsByPartner.has(e.campaign_partner_id)) {
      meetingsByPartner.set(e.campaign_partner_id, e);
    }
  }

  const latestOutboundByPartner = new Map<string, string>();
  for (const e of events) {
    if (e.direction !== "outbound") continue;
    const existing = latestOutboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      latestOutboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }

  const needsFollowUp: LegacyPartner[] = [];
  for (const p of partners) {
    if (!p.status_code) continue;
    if (!POST_REPLY_CODES.includes(p.status_code)) continue;
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) {
      needsFollowUp.push(p);
      continue;
    }
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days > 5) needsFollowUp.push(p);
  }

  const inboundByPartner = new Map<string, string>();
  for (const e of events) {
    if (e.direction !== "inbound") continue;
    const existing = inboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      inboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }
  const silentOver7d: LegacyPartner[] = [];
  for (const p of partners) {
    if (p.status_code !== "+3") continue;
    const lastIn = inboundByPartner.get(p.id);
    if (lastIn && new Date(lastIn).getTime() > windowStart.getTime()) continue;
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) continue;
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days >= 7) silentOver7d.push(p);
  }

  const handoverEvents = events.filter((e) => inLast7(e.event_at) && e.event_type === "handover");
  const handoverPartnerIds = new Set(handoverEvents.map((e) => e.campaign_partner_id));
  const handoverPartners = partners.filter((p) => handoverPartnerIds.has(p.id));

  const declinePartners = partners.filter(
    (p) => p.status_code === "-1" && p.last_contact_at && inLast7(p.last_contact_at),
  );

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

  const distribution = new Map<string, number>();
  for (const code of STATUS_CODES) distribution.set(code, 0);
  for (const p of partners) {
    if (p.status_code && distribution.has(p.status_code)) {
      distribution.set(p.status_code, (distribution.get(p.status_code) ?? 0) + 1);
    }
  }

  const stats = {
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

  const weekLabel = weekOfLabel(now);
  const subject = `[DIGEST] ${campaign.name} - week of ${weekLabel}: ${stats.sent} sent, ${stats.replies} replies, ${stats.meetings_booked} meetings`;

  const lines: string[] = [];
  lines.push("Hi,");
  lines.push("");
  lines.push(`Here's what happened on ${campaign.name} in the last 7 days.`);
  lines.push("");
  lines.push("HEADLINE");
  lines.push(`* ${stats.sent} first-contacts sent`);
  lines.push(
    `* ${stats.replies} replies received (${repliesPositive} positive, ${repliesNegative} negative, ${repliesNeutral} neutral)`,
  );
  if (meetingsByPartner.size === 0) {
    lines.push(`* 0 meetings booked`);
  } else {
    const meetingLines: string[] = [];
    for (const [partnerId, ev] of meetingsByPartner.entries()) {
      const p = partnersById.get(partnerId);
      meetingLines.push(`${firmFor(p)} (${shortDate(ev.event_at)})`);
    }
    lines.push(`* ${stats.meetings_booked} meetings booked: ${meetingLines.join("; ")}`);
  }
  if (!selfManaged) {
    if (handoverPartners.length === 0) {
      lines.push(`* 0 handed over to the company`);
    } else {
      const firms = handoverPartners.map((p) => firmFor(p)).join(", ");
      lines.push(`* ${handoverPartners.length} handed over to the company: ${firms}`);
    }
  }
  if (declinePartners.length > 0) {
    const firms = declinePartners.map((p) => firmFor(p)).join(", ");
    lines.push(`* ${declinePartners.length} declined this week: ${firms}`);
  }
  lines.push("");

  lines.push("NEEDS YOUR ATTENTION");
  if (needsFollowUp.length === 0 && silentOver7d.length === 0) {
    lines.push(
      "No stuck conversations. Nothing at +6 or later has been silent for more than 5 days.",
    );
  } else {
    if (needsFollowUp.length > 0) {
      for (const p of needsFollowUp.slice(0, 20)) {
        const firm = firmFor(p);
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : null;
        const tail = days === null ? "no outbound logged" : `${days}d since last outbound`;
        lines.push(
          `* ${firm} [${p.status_code} ${STATUS_LABELS[p.status_code ?? ""] ?? ""}] - ${tail}`,
        );
      }
      if (needsFollowUp.length > 20) lines.push(`... and ${needsFollowUp.length - 20} more`);
    }
    if (silentOver7d.length > 0) {
      lines.push("");
      lines.push("Silent over 7 days at +3 (no reply since first contact):");
      for (const p of silentOver7d.slice(0, 20)) {
        const firm = firmFor(p);
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : 7;
        lines.push(`* ${firm} - ${days}d silent`);
      }
      if (silentOver7d.length > 20) lines.push(`... and ${silentOver7d.length - 20} more`);
    }
  }
  lines.push("");

  lines.push("UPCOMING FOLLOW-UPS (next 7 days)");
  if (upcomingFollowUps.length === 0) {
    lines.push("No follow-ups scheduled. Log a follow-up from any tracker row to populate this.");
  } else {
    for (const ev of upcomingFollowUps.slice(0, 20)) {
      const p = partnersById.get(ev.campaign_partner_id);
      const due = shortDate(ev.follow_up_due_at!);
      const titleTail = ev.title ? ` - ${ev.title}` : "";
      lines.push(`* ${due}: ${firmFor(p)}${titleTail}`);
    }
    if (upcomingFollowUps.length > 20) {
      lines.push(`... and ${upcomingFollowUps.length - 20} more`);
    }
  }
  lines.push("");

  lines.push("STATUS DISTRIBUTION");
  const parts: string[] = [];
  for (const code of STATUS_CODES) {
    const n = distribution.get(code) ?? 0;
    if (n > 0) parts.push(`${code}: ${n}`);
  }
  lines.push(parts.length > 0 ? parts.join(" * ") : `No ${nounPlural} on this campaign yet.`);
  lines.push("");
  lines.push("-- auto-generated by forge-capital-app. Reply to mark done.");

  return { subject, body: lines.join("\n"), stats };
}
