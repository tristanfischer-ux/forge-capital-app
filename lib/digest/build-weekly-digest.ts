import { labelFor, STATUS_CODES } from "@/lib/status-codes";
import {
  extraSubjectHints,
  subjectNamesOtherMandate,
  type MandateHint,
} from "@/lib/digest/campaign-mandate";
import {
  emailDomain,
  gmailSourceKeys,
  isDncFirmName,
  MS_PER_DAY,
  normFirmName,
  statusRank,
  stripDncPrefix,
  websiteDomain,
} from "@/lib/digest/names";
import type {
  AttentionRowDebug,
  DigestDebug,
  DigestEvent,
  DigestLoadedData,
  DigestPartner,
  DroppedEvent,
  ForgeOsActivity,
  ForgeOsFirm,
  MergedFirm,
  SuppressedFirm,
  WeeklyDigestResult,
  WeeklyDigestStats,
} from "@/lib/digest/types";

const POST_REPLY_MIN = 6;

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

function partnerNounPlural(intent: string | null): string {
  if (intent === "customer") return "customers";
  if (intent === "supplier") return "suppliers";
  return "investors";
}

function displayFirmName(name: string | null | undefined): string {
  if (!name) return "(unknown firm)";
  const stripped = stripDncPrefix(name);
  return stripped || name;
}

type FirmIndex = {
  byId: Map<string, ForgeOsFirm>;
  byDomain: Map<string, ForgeOsFirm[]>;
  byNorm: Map<string, ForgeOsFirm[]>;
  aliasNorm: Map<string, string>;
};

function indexFirms(
  firms: ForgeOsFirm[],
  aliases: DigestLoadedData["aliases"],
): FirmIndex {
  const byId = new Map<string, ForgeOsFirm>();
  const byDomain = new Map<string, ForgeOsFirm[]>();
  const byNorm = new Map<string, ForgeOsFirm[]>();
  for (const f of firms) {
    byId.set(f.id, f);
    if (f.website_domain) {
      const d = f.website_domain.replace(/^www\./, "").toLowerCase();
      const list = byDomain.get(d) ?? [];
      list.push(f);
      byDomain.set(d, list);
    }
    const n = (f.norm_name || normFirmName(f.canonical_name)).trim();
    if (n) {
      const list = byNorm.get(n) ?? [];
      list.push(f);
      byNorm.set(n, list);
    }
    const stripped = normFirmName(f.canonical_name);
    if (stripped && stripped !== n) {
      const list = byNorm.get(stripped) ?? [];
      list.push(f);
      byNorm.set(stripped, list);
    }
  }
  const aliasNorm = new Map<string, string>();
  for (const a of aliases) {
    const n = (a.norm_alias || normFirmName(a.alias)).trim();
    if (n && a.firm_id) aliasNorm.set(n, a.firm_id);
  }
  return { byId, byDomain, byNorm, aliasNorm };
}

function pickFirm(candidates: ForgeOsFirm[] | undefined): ForgeOsFirm | null {
  if (!candidates?.length) return null;
  const dnc = candidates.find((f) => f.dnc);
  return dnc ?? candidates[0];
}

function matchPartnerFirm(
  partner: DigestPartner,
  index: FirmIndex,
  peopleByEmail: Map<string, DigestLoadedData["people"][number]>,
): { firm: ForgeOsFirm | null; via: string | null } {
  const domains = [
    websiteDomain(partner.website),
    emailDomain(partner.partner_email),
  ].filter((d): d is string => Boolean(d));
  for (const d of domains) {
    const hit = pickFirm(index.byDomain.get(d));
    if (hit) return { firm: hit, via: `domain:${d}` };
  }
  const email = (partner.partner_email ?? "").trim().toLowerCase();
  if (email) {
    const person = peopleByEmail.get(email);
    if (person?.firm_id) {
      const f = index.byId.get(person.firm_id);
      if (f) return { firm: f, via: `person:${email}` };
    }
  }
  const norm = normFirmName(partner.firm_name);
  if (norm) {
    const aliasFirmId = index.aliasNorm.get(norm);
    if (aliasFirmId) {
      const f = index.byId.get(aliasFirmId);
      if (f) return { firm: f, via: `alias:${norm}` };
    }
    const byName = pickFirm(index.byNorm.get(norm));
    if (byName) return { firm: byName, via: `name:${norm}` };
  }
  return { firm: null, via: null };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) this.parent.set(x, this.find(p));
    return this.parent.get(x)!;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

type FirmGroup = {
  key: string;
  partnerIds: string[];
  partners: DigestPartner[];
  investorIds: number[];
  forgeosFirmIds: string[];
  name: string;
  statusCode: string | null;
  lastContactAt: string | null;
  suppressed: boolean;
  reasons: string[];
};

function mergePartners(
  partners: DigestPartner[],
  index: FirmIndex,
  peopleByEmail: Map<string, DigestLoadedData["people"][number]>,
  blockedFirmIds: Set<string>,
  blockedPersonIds: Set<string>,
): { groups: FirmGroup[]; merged: MergedFirm[]; suppressed: SuppressedFirm[] } {
  const uf = new UnionFind();
  const buckets = new Map<string, string[]>();
  const matchByPartner = new Map<string, { firm: ForgeOsFirm | null; via: string | null }>();

  const addBucket = (key: string, partnerId: string) => {
    const list = buckets.get(key) ?? [];
    list.push(partnerId);
    buckets.set(key, list);
  };

  for (const p of partners) {
    uf.find(p.id);
    const match = matchPartnerFirm(p, index, peopleByEmail);
    matchByPartner.set(p.id, match);
    if (p.investor_id != null) addBucket(`inv:${p.investor_id}`, p.id);
    if (match.firm) addBucket(`fos:${match.firm.id}`, p.id);
    const domains = [
      websiteDomain(p.website),
      emailDomain(p.partner_email),
      match.firm?.website_domain?.replace(/^www\./, "").toLowerCase() ?? null,
    ].filter((d): d is string => Boolean(d));
    for (const d of domains) addBucket(`dom:${d}`, p.id);
    const norm = normFirmName(p.firm_name);
    if (norm) addBucket(`name:${norm}`, p.id);
  }
  for (const ids of buckets.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  const grouped = new Map<string, DigestPartner[]>();
  for (const p of partners) {
    const root = uf.find(p.id);
    const list = grouped.get(root) ?? [];
    list.push(p);
    grouped.set(root, list);
  }

  const groups: FirmGroup[] = [];
  const merged: MergedFirm[] = [];
  const suppressed: SuppressedFirm[] = [];

  for (const [root, members] of grouped) {
    const investorIds = [
      ...new Set(members.map((m) => m.investor_id).filter((id): id is number => id != null)),
    ];
    const forgeosFirmIds = [
      ...new Set(
        members
          .map((m) => matchByPartner.get(m.id)?.firm?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let best: DigestPartner = members[0];
    for (const m of members) {
      if (statusRank(m.status_code) > statusRank(best.status_code)) best = m;
    }
    const names = members
      .map((m) => m.firm_name)
      .filter((n): n is string => Boolean(n) && !isDncFirmName(n));
    const named = (!isDncFirmName(best.firm_name) && best.firm_name) || names[0] || members[0].firm_name || "(unknown firm)";
    const reasons: string[] = [];
    if (members.some((m) => m.status_code === "-3")) reasons.push("apex_status_-3");
    if (members.some((m) => isDncFirmName(m.firm_name))) reasons.push("apex_dnc_prefix");
    for (const fid of forgeosFirmIds) {
      const f = index.byId.get(fid);
      if (f?.dnc) reasons.push(`forgeos_firm_dnc:${fid}`);
      if (blockedFirmIds.has(fid)) reasons.push(`forgeos_participation_blocked:${fid}`);
    }
    for (const m of members) {
      const email = (m.partner_email ?? "").trim().toLowerCase();
      if (!email) continue;
      const person = peopleByEmail.get(email);
      if (person?.dnc) reasons.push(`forgeos_person_dnc:${person.id}`);
      if (person && blockedPersonIds.has(person.id)) {
        reasons.push(`forgeos_person_blocked:${person.id}`);
      }
      if (person?.firm_id && blockedFirmIds.has(person.firm_id)) {
        reasons.push(`forgeos_participation_blocked:${person.firm_id}`);
      }
    }
    const group: FirmGroup = {
      key: root,
      partnerIds: members.map((m) => m.id),
      partners: members,
      investorIds,
      forgeosFirmIds,
      name: displayFirmName(named),
      statusCode: best.status_code,
      lastContactAt: members
        .map((m) => m.last_contact_at)
        .filter((x): x is string => Boolean(x))
        .sort()
        .at(-1) ?? null,
      suppressed: reasons.length > 0,
      reasons: [...new Set(reasons)],
    };
    groups.push(group);
    if (members.length > 1 || investorIds.length > 1) {
      merged.push({
        key: root,
        name: group.name,
        investor_ids: investorIds,
        partner_ids: group.partnerIds,
        forgeos_firm_ids: forgeosFirmIds,
      });
    }
    if (group.suppressed) {
      suppressed.push({
        key: root,
        name: group.name,
        investor_ids: investorIds,
        reasons: group.reasons,
      });
    }
  }
  return { groups, merged, suppressed };
}

function activitiesForGmail(
  gmailId: string | null | undefined,
  bySource: Map<string, ForgeOsActivity[]>,
): ForgeOsActivity[] {
  const out: ForgeOsActivity[] = [];
  const seen = new Set<string>();
  for (const key of gmailSourceKeys(gmailId)) {
    for (const a of bySource.get(key) ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

function classifyEvent(
  event: DigestEvent,
  mandate: MandateHint | null,
  otherMandates: MandateHint[],
  bySource: Map<string, ForgeOsActivity[]>,
  codeByMandateId: Map<string, string>,
): { keep: boolean; drop?: DroppedEvent } {
  const acts = [
    ...activitiesForGmail(event.gmail_message_id, bySource),
    ...activitiesForGmail(event.gmail_thread_id, bySource),
  ];
  const seen = new Set<string>();
  const uniqueActs: ForgeOsActivity[] = [];
  for (const a of acts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    uniqueActs.push(a);
  }
  const linked = new Set<string>();
  for (const a of uniqueActs) {
    for (const id of a.mandate_ids) linked.add(id);
  }
  const linkedCodes = [...linked].map((id) => codeByMandateId.get(id) ?? id.slice(0, 8));
  if (mandate && linked.size > 0) {
    const foreign = [...linked].filter((id) => id !== mandate.id);
    if (foreign.length > 0) {
      return {
        keep: false,
        drop: {
          event_id: event.id,
          gmail_message_id: event.gmail_message_id,
          gmail_thread_id: event.gmail_thread_id,
          summary: event.summary,
          reason: `forgeos_other_mandate:${linkedCodes.join(",")}`,
          linked_mandate_codes: linkedCodes,
        },
      };
    }
    return { keep: true };
  }
  const subject = `${event.summary ?? ""} ${event.title ?? ""}`;
  const thisHints = mandate?.hints ?? extraSubjectHints("");
  const other = subjectNamesOtherMandate(subject, thisHints, otherMandates);
  if (other) {
    return {
      keep: false,
      drop: {
        event_id: event.id,
        gmail_message_id: event.gmail_message_id,
        gmail_thread_id: event.gmail_thread_id,
        summary: event.summary,
        reason: `subject_other_mandate:${other.code}`,
        linked_mandate_codes: [other.code],
      },
    };
  }
  return { keep: true };
}

function isMeeting(e: DigestEvent): boolean {
  return (
    e.direction === "meeting" ||
    e.event_type === "meeting" ||
    e.event_type === "meeting_scheduled" ||
    e.event_type === "meeting_held"
  );
}

function daysBetween(now: Date, iso: string): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

export function buildWeeklyDigest(
  data: DigestLoadedData,
  now: Date,
): WeeklyDigestResult {
  const { campaign, partners, events, apexOutbound, mandate, otherMandates } = data;
  const selfManaged = !((campaign.counterpart_email ?? "").trim());
  const nounPlural = partnerNounPlural(campaign.campaign_intent);
  const windowStart = new Date(now.getTime() - 7 * MS_PER_DAY);
  const upcomingEnd = new Date(now.getTime() + 7 * MS_PER_DAY);

  const index = indexFirms(data.firms, data.aliases);
  const peopleByEmail = new Map<string, DigestLoadedData["people"][number]>();
  for (const p of data.people) {
    const email = (p.email ?? "").trim().toLowerCase();
    if (email) peopleByEmail.set(email, p);
  }
  const blockedFirmIds = new Set<string>();
  const blockedPersonIds = new Set<string>();
  for (const part of data.participations) {
    if (part.stage !== "blocked") continue;
    if (part.firm_id) blockedFirmIds.add(part.firm_id);
    if (part.person_id) blockedPersonIds.add(part.person_id);
  }

  const { groups, merged, suppressed } = mergePartners(
    partners,
    index,
    peopleByEmail,
    blockedFirmIds,
    blockedPersonIds,
  );
  const groupByPartnerId = new Map<string, FirmGroup>();
  for (const g of groups) {
    for (const id of g.partnerIds) groupByPartnerId.set(id, g);
  }
  const visibleGroups = groups.filter((g) => !g.suppressed);

  const bySource = new Map<string, ForgeOsActivity[]>();
  for (const a of data.activities) {
    for (const key of gmailSourceKeys(a.source_id)) {
      const list = bySource.get(key) ?? [];
      list.push(a);
      bySource.set(key, list);
    }
  }
  const codeByMandateId = new Map<string, string>();
  if (mandate) codeByMandateId.set(mandate.id, mandate.code);
  for (const o of otherMandates) codeByMandateId.set(o.id, o.code);

  const droppedEvents: DroppedEvent[] = [];
  const keptEvents: DigestEvent[] = [];
  const countedGmail = new Set<string>();
  for (const e of events) {
    const verdict = classifyEvent(e, mandate, otherMandates, bySource, codeByMandateId);
    if (!verdict.keep) {
      if (verdict.drop) droppedEvents.push(verdict.drop);
      continue;
    }
    const g = groupByPartnerId.get(e.campaign_partner_id);
    if (g?.suppressed) {
      droppedEvents.push({
        event_id: e.id,
        gmail_message_id: e.gmail_message_id,
        gmail_thread_id: e.gmail_thread_id,
        summary: e.summary,
        reason: `suppressed_firm:${g.reasons.join(",")}`,
        linked_mandate_codes: [],
      });
      continue;
    }
    keptEvents.push(e);
    if (e.gmail_message_id) countedGmail.add(e.gmail_message_id);
  }

  const forgeosOutByFirm = new Map<string, string>();
  for (const a of data.activities) {
    if (a.channel !== "email_out") continue;
    if (mandate && a.mandate_ids.length > 0 && !a.mandate_ids.includes(mandate.id)) {
      continue;
    }
    if (mandate && a.mandate_ids.length === 0) continue;
    for (const fid of a.firm_ids) {
      const existing = forgeosOutByFirm.get(fid);
      if (!existing || a.occurred_at > existing) forgeosOutByFirm.set(fid, a.occurred_at);
    }
  }

  const apexOutByGroup = new Map<string, string>();
  for (const e of apexOutbound) {
    if (e.direction !== "outbound") continue;
    const verdict = classifyEvent(e, mandate, otherMandates, bySource, codeByMandateId);
    if (!verdict.keep) continue;
    const g = groupByPartnerId.get(e.campaign_partner_id);
    if (!g || g.suppressed) continue;
    const existing = apexOutByGroup.get(g.key);
    if (!existing || e.event_at > existing) apexOutByGroup.set(g.key, e.event_at);
  }

  function forgeosOutboundFor(group: FirmGroup): string | null {
    let latest: string | null = null;
    for (const fid of group.forgeosFirmIds) {
      const at = forgeosOutByFirm.get(fid);
      if (at && (!latest || at > latest)) latest = at;
    }
    return latest;
  }

  function printedOutbound(group: FirmGroup): {
    forgeos: string | null;
    apex: string | null;
    date: string | null;
    noForgeos: boolean;
  } {
    const forgeos = forgeosOutboundFor(group);
    const apex = apexOutByGroup.get(group.key) ?? null;
    const noForgeos = !forgeos;
    let date: string | null = forgeos;
    if (forgeos && apex && new Date(apex).getTime() > new Date(forgeos).getTime()) {
      date = apex;
    }
    return { forgeos, apex, date, noForgeos };
  }

  const inLast7 = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= windowStart.getTime() && t <= now.getTime();
  };

  const sentEvents = keptEvents.filter((e) => inLast7(e.event_at) && e.direction === "outbound");
  const replyEvents = keptEvents.filter((e) => inLast7(e.event_at) && e.direction === "inbound");
  let repliesPositive = 0;
  let repliesNegative = 0;
  let repliesNeutral = 0;
  for (const e of replyEvents) {
    const tone = classifyReplyTone(e.summary);
    if (tone === "positive") repliesPositive += 1;
    else if (tone === "negative") repliesNegative += 1;
    else repliesNeutral += 1;
  }

  const meetingEvents = keptEvents.filter((e) => {
    if (!isMeeting(e)) return false;
    const t = new Date(e.event_at).getTime();
    return t >= windowStart.getTime() && t <= upcomingEnd.getTime();
  });
  const meetingsByGroup = new Map<string, DigestEvent>();
  for (const e of meetingEvents) {
    const g = groupByPartnerId.get(e.campaign_partner_id);
    if (!g || g.suppressed) continue;
    if (!meetingsByGroup.has(g.key)) meetingsByGroup.set(g.key, e);
  }

  const inboundByGroup = new Map<string, string>();
  for (const e of keptEvents) {
    if (e.direction !== "inbound") continue;
    const g = groupByPartnerId.get(e.campaign_partner_id);
    if (!g || g.suppressed) continue;
    const existing = inboundByGroup.get(g.key);
    if (!existing || e.event_at > existing) inboundByGroup.set(g.key, e.event_at);
  }

  const needsFollowUp: FirmGroup[] = [];
  const silentOver7d: FirmGroup[] = [];
  for (const g of visibleGroups) {
    const rank = statusRank(g.statusCode);
    if (rank >= POST_REPLY_MIN) {
      const out = printedOutbound(g);
      if (out.noForgeos) {
        needsFollowUp.push(g);
        continue;
      }
      if (out.date) {
        const days = (now.getTime() - new Date(out.date).getTime()) / MS_PER_DAY;
        if (days > 5) needsFollowUp.push(g);
      }
    }
    if (g.statusCode === "+3") {
      const lastIn = inboundByGroup.get(g.key);
      if (lastIn && new Date(lastIn).getTime() > windowStart.getTime()) continue;
      const out = printedOutbound(g);
      const date = out.noForgeos ? out.apex : out.date;
      if (!date) continue;
      const days = (now.getTime() - new Date(date).getTime()) / MS_PER_DAY;
      if (days >= 7) silentOver7d.push(g);
    }
  }

  const handoverPartnerIds = new Set(
    keptEvents
      .filter((e) => inLast7(e.event_at) && e.event_type === "handover")
      .map((e) => e.campaign_partner_id),
  );
  const handoverGroups = visibleGroups.filter((g) =>
    g.partnerIds.some((id) => handoverPartnerIds.has(id)),
  );

  const declineGroups = visibleGroups.filter(
    (g) =>
      g.statusCode === "-1" &&
      g.lastContactAt &&
      inLast7(g.lastContactAt),
  );

  const upcomingFollowUps = keptEvents
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
  for (const s of STATUS_CODES) distribution.set(s.code, 0);
  for (const g of visibleGroups) {
    if (g.statusCode && distribution.has(g.statusCode)) {
      distribution.set(g.statusCode, (distribution.get(g.statusCode) ?? 0) + 1);
    }
  }

  const stats: WeeklyDigestStats = {
    sent: sentEvents.length,
    replies: replyEvents.length,
    repliesPositive,
    repliesNegative,
    repliesNeutral,
    meetings_booked: meetingsByGroup.size,
    silent_over_7d: silentOver7d.length,
    handovers: handoverGroups.length,
    declines: declineGroups.length,
  };

  const weekLabel = weekOfLabel(now);
  const subject = `[DIGEST] ${campaign.name} - week of ${weekLabel}: ${stats.sent} sent, ${stats.replies} replies, ${stats.meetings_booked} meetings`;

  const attentionDebug: AttentionRowDebug[] = [];
  const silentDebug: AttentionRowDebug[] = [];

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
  if (meetingsByGroup.size === 0) {
    lines.push(`* 0 meetings booked`);
  } else {
    const meetingLines: string[] = [];
    for (const [key, ev] of meetingsByGroup.entries()) {
      const g = groups.find((x) => x.key === key);
      meetingLines.push(`${g?.name ?? "(unknown firm)"} (${shortDate(ev.event_at)})`);
    }
    lines.push(`* ${stats.meetings_booked} meetings booked: ${meetingLines.join("; ")}`);
  }
  if (!selfManaged) {
    if (handoverGroups.length === 0) {
      lines.push(`* 0 handed over to the company`);
    } else {
      const firms = handoverGroups.map((g) => g.name).join(", ");
      lines.push(`* ${handoverGroups.length} handed over to the company: ${firms}`);
    }
  }
  if (declineGroups.length > 0) {
    const firms = declineGroups.map((g) => g.name).join(", ");
    lines.push(`* ${declineGroups.length} declined this week: ${firms}`);
  }
  lines.push("");

  lines.push("NEEDS YOUR ATTENTION");
  if (needsFollowUp.length === 0 && silentOver7d.length === 0) {
    lines.push(
      "No stuck conversations. Nothing at +6 or later has been silent for more than 5 days.",
    );
  } else {
    if (needsFollowUp.length > 0) {
      for (const g of needsFollowUp.slice(0, 20)) {
        const out = printedOutbound(g);
        const statusLabel = labelFor(g.statusCode) ?? "";
        let printed: string;
        let days: number | null = null;
        if (out.noForgeos) {
          printed = "no outbound logged";
        } else if (out.date) {
          days = daysBetween(now, out.date);
          printed = `${days}d since last outbound`;
        } else {
          printed = "no outbound logged";
        }
        attentionDebug.push({
          name: g.name,
          status_code: g.statusCode ?? "",
          forgeos_outbound_at: out.forgeos,
          apex_outbound_at: out.apex,
          printed,
          days,
        });
        lines.push(
          `* ${g.name} [${g.statusCode} ${statusLabel}] - ${printed}`,
        );
      }
      if (needsFollowUp.length > 20) {
        lines.push(`... and ${needsFollowUp.length - 20} more`);
      }
    }
    if (silentOver7d.length > 0) {
      lines.push("");
      lines.push("Silent over 7 days at +3 (no reply since first contact):");
      for (const g of silentOver7d.slice(0, 20)) {
        const out = printedOutbound(g);
        const date = out.noForgeos ? out.apex : out.date;
        const days = date ? daysBetween(now, date) : 7;
        const printed = `${days}d silent`;
        silentDebug.push({
          name: g.name,
          status_code: g.statusCode ?? "+3",
          forgeos_outbound_at: out.forgeos,
          apex_outbound_at: out.apex,
          printed,
          days,
        });
        lines.push(`* ${g.name} - ${printed}`);
      }
      if (silentOver7d.length > 20) {
        lines.push(`... and ${silentOver7d.length - 20} more`);
      }
    }
  }
  lines.push("");

  lines.push("UPCOMING FOLLOW-UPS (next 7 days)");
  const upcomingVisible = upcomingFollowUps.filter((ev) => {
    const g = groupByPartnerId.get(ev.campaign_partner_id);
    return g && !g.suppressed;
  });
  if (upcomingVisible.length === 0) {
    lines.push(
      "No follow-ups scheduled. Log a follow-up from any tracker row to populate this.",
    );
  } else {
    const seenFirm = new Set<string>();
    let shown = 0;
    for (const ev of upcomingVisible) {
      const g = groupByPartnerId.get(ev.campaign_partner_id);
      if (!g || seenFirm.has(g.key)) continue;
      seenFirm.add(g.key);
      const due = shortDate(ev.follow_up_due_at!);
      const titleTail = ev.title ? ` - ${ev.title}` : "";
      lines.push(`* ${due}: ${g.name}${titleTail}`);
      shown += 1;
      if (shown >= 20) break;
    }
    if (seenFirm.size > 20) {
      lines.push(`... and ${seenFirm.size - 20} more`);
    }
  }
  lines.push("");

  lines.push("STATUS DISTRIBUTION");
  const parts: string[] = [];
  for (const s of STATUS_CODES) {
    const n = distribution.get(s.code) ?? 0;
    if (n > 0) parts.push(`${s.code}: ${n}`);
  }
  lines.push(
    parts.length > 0 ? parts.join(" * ") : `No ${nounPlural} on this campaign yet.`,
  );
  lines.push("");
  lines.push("-- auto-generated by forge-capital-app. Reply to mark done.");

  const debug: DigestDebug = {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    mandate_code: mandate?.code ?? null,
    mandate_id: mandate?.id ?? null,
    unmapped_reason: data.unmappedReason,
    counted_gmail_ids: [...countedGmail],
    dropped_events: droppedEvents,
    suppressed_firms: suppressed,
    merged_firms: merged,
    attention: attentionDebug,
    silent: silentDebug,
  };

  return { subject, body: lines.join("\n"), stats, debug };
}
