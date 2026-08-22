import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MeetingBriefFile, MeetingCorrespondence } from "@/lib/queries/meeting-brief";
import type { DeskMeeting, DeskReply } from "@/lib/queries/desk-today";

/** Standing mandate facts. Narrative constraints are from the v2 brief (17 Aug 2026). */
export type MandateKey =
  | "space-solar"
  | "odysseus"
  | "skysails"
  | "fishfrom"
  | "hooley"
  | "panatere"
  | "ned-mps"
  | "yuri";

export interface MandateStanding {
  key: MandateKey;
  name: string;
  kind: "raise" | "ned" | "customer";
  ask: string;
  principal: string;
  doNotSay: string[];
  liveQuestion: string;
}

export interface MandateUpdate {
  key: MandateKey;
  as_of: string;
  fact: string;
  source: string;
}

export interface MandateBrief {
  key: MandateKey;
  name: string;
  kind: "raise" | "ned" | "customer";
  namedByThem: boolean;
  ask: string;
  principal: string;
  latest: MandateUpdate | null;
  doNotSay: string[];
  liveQuestion: string;
  line: string;
}

export const MANDATE_STANDING: MandateStanding[] = [
  {
    key: "space-solar",
    name: "Space Solar",
    kind: "raise",
    ask: "£10M",
    principal: "Richard Winslade",
    doNotSay: [
      "Do not use the “prime” framing",
      "Nasdaq intention (years 3–5) is for US investors only — never the website, never UK government",
    ],
    liveQuestion: "If they are here for Space Solar: the live ask is £10M, and whether they will take a first meeting on that.",
  },
  {
    key: "odysseus",
    name: "Odysseus Space",
    kind: "raise",
    ask: "€8M at about €32M pre",
    principal: "Jordan Vannitsen",
    doNotSay: [
      "Lead with larger arrays and optical ground stations / SSA",
      "Be ready on the Starlink question",
    ],
    liveQuestion: "If they are here for Odysseus: Flight Terminal is going out now — what do they need to see to stay in the process.",
  },
  {
    key: "skysails",
    name: "SkySails Power",
    kind: "raise",
    ask: "€5M Series A bridge (Kembara indicated as a later Series B lead)",
    principal: "Stephan Wrage",
    doNotSay: ["Do not invent a new round size on this call"],
    liveQuestion: "If they are here for SkySails: the bridge, and whether they already know Stephan.",
  },
  {
    key: "fishfrom",
    name: "FishFrom Technologies",
    kind: "raise",
    ask: "Bridge ahead of first full-scale farm (partnership conversations are not the raise)",
    principal: "Andrew Robertson",
    doNotSay: ["Do not pitch a fundraise to a partnership / AOP slot"],
    liveQuestion: "If this is the raise: who they want in the room. If it is partnership: the in-line MIB unit, not the book.",
  },
  {
    key: "hooley",
    name: "Hooley RF",
    kind: "raise",
    ask: "Not yet defined — all equity outreach gated on Tony Hooley",
    principal: "Tony Hooley",
    doNotSay: ["Do not run an equity conversation unless Tony has signed it off"],
    liveQuestion: "If this is product (airship aperture): keep it concrete. If it is the raise: stop and check Tony.",
  },
  {
    key: "panatere",
    name: "Panatere",
    kind: "raise",
    ask: "Swiss Series A — counterpart is Andreas Cser, not a Panatere CEO",
    principal: "Andreas Cser (Fraser Finance)",
    doNotSay: ["Do not name a Panatere CEO"],
    liveQuestion: "If they are here for Panatere: route through Andreas.",
  },
  {
    key: "ned-mps",
    name: "NED — Marine Power Systems",
    kind: "ned",
    ask: "Not a raise. NED intro after Aquamarine → PelaFlex.",
    principal: "You",
    doNotSay: ["Do not open a fundraise pitch"],
    liveQuestion: "What Gareth wants from a NED conversation, and whether a further meeting is useful.",
  },
  {
    key: "yuri",
    name: "Yuri — RPM customers",
    kind: "customer",
    ask: "Voice-of-customer on the RPM — not a raise",
    principal: "Maria Birlem",
    doNotSay: [
      "Do not pitch a fundraise to RPM labs",
      "Do not invent a microgravity link",
      "Do not contact the university that wanted to sue until Maria flags it",
    ],
    liveQuestion: "How they use the RPM, and where the science and the hardware should go next.",
  },
];

/** Dated facts we actually have (mail, calendar, principals). Overlay file may add more. */
const SEEDED_UPDATES: MandateUpdate[] = [
  {
    key: "space-solar",
    as_of: "2026-08-04",
    fact: "You wrote Uwe Horstmann at Project A a Space Solar letter (£60M Series A in that subject). He was out until 16 August.",
    source: "Gmail · 4 Aug 2026 · you → uwe@project-a.vc",
  },
  {
    key: "odysseus",
    as_of: "2026-08-16",
    fact: "Jordan asked Medina to move (Flight Terminal delivery). Raul cancelled the 17 August 10:00 ET slot and offered the following week.",
    source: "Gmail · 16 Aug 2026 · Jordan → Raul, then Raul cancel",
  },
  {
    key: "odysseus",
    as_of: "2026-08-04",
    fact: "You wrote Christoph Roesler at Project A an Odysseus letter (€8M optical downlink).",
    source: "Gmail · 4 Aug 2026 · you → christoph.roesler@project-a.vc",
  },
  {
    key: "skysails",
    as_of: "2026-03-26",
    fact: "You introduced airborne energy / SkySails to Uwe at Project A. No later Project A reply on SkySails is on this desk.",
    source: "Gmail · 26 Mar 2026 · you → uwe@project-a.com",
  },
  {
    key: "hooley",
    as_of: "2026-08-16",
    fact: "Tony passed the UKSA / NSIP E-band phased-array note to Alex at MISL with editorial changes.",
    source: "Gmail · 16 Aug 2026 · Tony Hooley → you",
  },
  {
    key: "fishfrom",
    as_of: "2026-08-06",
    fact: "Assaf (Atlantium) booked 17 August on in-line MIB / geosmin for RAS and asked what to prepare. Thorsten (FREA) booked the same day in July to hear the technology.",
    source: "Gmail · July–August 2026 partnership threads",
  },
  {
    key: "ned-mps",
    as_of: "2026-08-14",
    fact: "Gareth offered Wednesday–Friday; you booked Wednesday 19 August 09:30 Teams.",
    source: "Gmail · 14 Aug 2026 · Gareth ↔ you",
  },
  {
    key: "yuri",
    as_of: "2026-08-21",
    fact: "Marcelo Vazquez (Canadian Nuclear Labs) — strong radiation×microgravity champion; non-metallic RPM parts so radiation fields are not distorted; rental/subscription to get labs onto the kit.",
    source: "Gemini notes · 21 Aug 2026 · Yuri RPM / Marcelo Vazquez",
  },
  {
    key: "yuri",
    as_of: "2026-08-13",
    fact: "Jamie Foster (University of Florida) — outstanding VoC; explaining the algorithm's value could ~5× the market; ~6-year user, needs a second unit. Intros to Angelini and Menezes sent the same day.",
    source: "Gemini notes + Gmail · 13 Aug 2026",
  },
];

const HINTS: { key: MandateKey; re: RegExp }[] = [
  { key: "space-solar", re: /space solar/i },
  { key: "odysseus", re: /odysseus/i },
  { key: "skysails", re: /skysails|stephan wrage|\bstephan update/i },
  { key: "fishfrom", re: /fishfrom|geosmin|\bmib\b|frea|atlantium/i },
  { key: "hooley", re: /hooley|avealto|airship|e-band|steerable aperture/i },
  { key: "panatere", re: /panatere/i },
  { key: "ned-mps", re: /gareth stockman|pelaflex|aquamarine|marine power/i },
  { key: "yuri", re: /\byuri\b|yurigravity|\brpm\b|random positioning|marcelo vazquez|jamie foster/i },
];

function loadOverlayUpdates(): MandateUpdate[] {
  const file = join(process.cwd(), "data/mandate-updates.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as MandateUpdate[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function allMandateUpdates(): MandateUpdate[] {
  return [...SEEDED_UPDATES, ...loadOverlayUpdates()].sort((a, b) =>
    a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : 0,
  );
}

export function standingFor(key: MandateKey): MandateStanding {
  return MANDATE_STANDING.find((m) => m.key === key)!;
}

export function latestUpdate(key: MandateKey): MandateUpdate | null {
  return allMandateUpdates().find((u) => u.key === key) ?? null;
}

export function inferMandateKeys(blob: string): MandateKey[] {
  const found: MandateKey[] = [];
  for (const { key, re } of HINTS) {
    if (re.test(blob) && !found.includes(key)) found.push(key);
  }
  return found;
}

export function inferMandatesForMeeting(
  meeting: Pick<DeskMeeting, "title" | "summary" | "notes" | "campaign_name" | "partner_name" | "firm_name">,
  filed: MeetingBriefFile | null,
): MandateBrief[] {
  const mail = (filed?.correspondence ?? [])
    .map((m) => `${m.subject} ${m.snippet}`)
    .join("\n");
  const blob = [
    meeting.title,
    meeting.summary,
    meeting.notes,
    meeting.campaign_name,
    meeting.partner_name,
    meeting.firm_name,
    filed?.campaign_name,
    filed?.brief.raise,
    filed?.brief.why_this_call,
    filed?.brief.how_they_arrived,
    filed?.brief.email_story,
    filed?.brief.firm,
    mail,
  ]
    .filter(Boolean)
    .join("\n");

  const keys = inferMandateKeys(blob);
  // Only the invite / filed raise — not our own cheat-sheet prose.
  const namedBlob = `${meeting.title ?? ""} ${meeting.campaign_name ?? ""} ${filed?.campaign_name ?? ""}`;
  return keys.map((key) => toBrief(key, inferMandateKeys(namedBlob).includes(key)));
}

function toBrief(key: MandateKey, namedByThem: boolean): MandateBrief {
  const standing = standingFor(key);
  const latest = latestUpdate(key);
  const asOf = latest
    ? new Date(latest.as_of).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  const line = latest
    ? `${standing.name}: ${latest.fact} (${asOf}.)`
    : `${standing.name}: no dated update on the desk. Ask is ${standing.ask}.`;
  return {
    key,
    name: standing.name,
    kind: standing.kind,
    namedByThem,
    ask: standing.ask,
    principal: standing.principal,
    latest,
    doNotSay: standing.doNotSay,
    liveQuestion: standing.liveQuestion,
    line,
  };
}

export function formatUpdateDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export interface TodayJob {
  kind: "prep" | "reschedule" | "file" | "quiet" | "letters";
  title: string;
  body: string;
  href: string;
  cta: string;
}

export function proposeTodayJob(input: {
  now?: Date;
  meetings: DeskMeeting[];
  replies: DeskReply[];
  stuckCount: number;
  approvalCount: number;
  canceledMeetings: DeskMeeting[];
}): TodayJob {
  const now = input.now ?? new Date();
  const upcoming = input.meetings
    .filter((m) => !m.canceled)
    .filter((m) => new Date(m.event_at).getTime() >= now.getTime() - 15 * 60_000)
    .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime());
  const next = upcoming[0];
  if (next) {
    const when = new Date(next.event_at);
    const who = (next.partner_name ?? next.title ?? "the next meeting").trim();
    const clock = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const sameDay = when.toDateString() === now.toDateString();
    const mins = Math.round((when.getTime() - now.getTime()) / 60_000);
    const whenLine = mins <= 0
      ? "This slot is now."
      : sameDay
        ? `Today at ${clock}.`
        : `${when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at ${clock}.`;
    return {
      kind: "prep",
      title: `${who} · ${clock}`,
      body: `${whenLine} Open the briefing for who they are, the firm, the mail, and your notes.`,
      href: `/meeting/${encodeURIComponent(next.id)}`,
      cta: "Open the briefing",
    };
  }

  const toReschedule = input.canceledMeetings[0];
  if (toReschedule) {
    return {
      kind: "reschedule",
      title: "Reschedule a cancelled slot",
      body: `${toReschedule.title ?? toReschedule.partner_name ?? "A meeting"} was cancelled. The mail offered another week — do not prep as if it is live.`,
      href: `/meeting/${encodeURIComponent(toReschedule.id)}`,
      cta: "Open the cancelled briefing",
    };
  }

  const unmatched = input.meetings.filter((m) => m.unmatched && !m.canceled);
  if (unmatched.length > 0) {
    return {
      kind: "file",
      title: `File ${unmatched.length} calendar name${unmatched.length === 1 ? "" : "s"}`,
      body: "They are on your week and not a unique person on a raise — principals and breakfasts should not look like unknown leads.",
      href: `/meeting/${encodeURIComponent(unmatched[0].id)}`,
      cta: "Open the first unmatched slot",
    };
  }

  if (input.stuckCount > 0) {
    return {
      kind: "quiet",
      title: `${input.stuckCount.toLocaleString("en-GB")} people have gone quiet`,
      body: "You wrote, they have not replied for ten days or more. Chasers parks Gmail drafts. Nothing sends.",
      href: "/chasers",
      cta: "Open Chasers",
    };
  }

  if (input.approvalCount > 0) {
    return {
      kind: "letters",
      title: `${input.approvalCount.toLocaleString("en-GB")} approved, not yet written`,
      body: "Principal said yes. Outreach writes the first letters as Gmail drafts.",
      href: "/outreach",
      cta: "Open Outreach",
    };
  }

  return {
    kind: "letters",
    title: "Nothing timed this morning",
    body: "Meetings and replies are below. Find new names on Outreach, or follow up quiet threads on Chasers.",
    href: "/outreach",
    cta: "Open Outreach",
  };
}

export function todayDigest(input: {
  meetings: DeskMeeting[];
  replies: DeskReply[];
  approvalCount: number;
  now?: Date;
}): string[] {
  const now = input.now ?? new Date();
  const lines: string[] = [];
  const canceled = input.meetings.filter((m) => m.canceled);
  if (canceled.length) {
    lines.push(
      `${canceled.map((m) => m.title ?? m.partner_name ?? "A slot").join("; ")} ${canceled.length === 1 ? "is" : "are"} cancelled — do not prep ${canceled.length === 1 ? "it" : "them"} as live.`,
    );
  }
  const next = input.meetings
    .filter((m) => !m.canceled && new Date(m.event_at).getTime() >= now.getTime() - 15 * 60_000)
    .sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime())[0];
  if (next) {
    const t = new Date(next.event_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(
      `Next live meeting: ${next.partner_name ?? next.title} at ${t}.`,
    );
  }
  const inbound = input.replies.filter(
    (r) => !/calendly|accepted:|canceled|cancelled/i.test(r.summary ?? ""),
  ).length;
  if (inbound) {
    lines.push(`${inbound} inbound replies this week — listed further down this page.`);
  }
  return lines.slice(0, 3);
}

export function mailLooksCanceled(mail: MeetingCorrespondence[]): boolean {
  return mail.some((m) => /canceled|cancelled/i.test(`${m.subject} ${m.snippet}`));
}

export function significantTokens(s: string): string[] {
  const stop = new Set([
    "meeting",
    "canceled",
    "cancelled",
    "invitation",
    "accepted",
    "ventures",
    "and",
    "the",
    "for",
    "with",
    "from",
    "this",
    "call",
    "update",
  ]);
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !stop.has(w));
}

export function titleMatchesCancel(meetingTitle: string | null, replySubject: string | null): boolean {
  if (!meetingTitle || !replySubject) return false;
  if (!/canceled|cancelled/i.test(replySubject)) return false;
  const have = new Set(significantTokens(meetingTitle));
  const hits = significantTokens(replySubject).filter((w) => have.has(w));
  return hits.length >= 2;
}
