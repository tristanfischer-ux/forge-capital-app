import { displayPersonName, resolveMeetingBook, type MeetingBook } from "@/lib/queries/resolve-meeting";
import {
  decodeMailText,
  isYouAddress,
  type MeetingCorrespondence,
} from "@/lib/queries/meeting-brief";
import type { DeskMeeting } from "@/lib/queries/desk-today";
import { inferMandatesForMeeting, type MandateBrief } from "@/lib/desk/mandate-state";
import type { LinkedInBrief } from "@/lib/capital/person-linkedin";
import { loadLiveCorrespondence } from "@/lib/queries/live-correspondence";
import { listWeekAheadCalendar } from "@/lib/capital/live-calendar";

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "")}.`;
}

function cleanInvite(notes: string | null | undefined): string | null {
  if (!notes) return null;
  let t = notes
    .replace(/_{8,}[\s\S]*$/m, "")
    .replace(/Microsoft Teams meeting[\s\S]*/i, "")
    .replace(/Join with Google Meet[\s\S]*/i, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/CONFIRMED[^.|]*[.|]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const first = t.split(/\s*\|\s*/)[0] ?? t;
  t = first.replace(/\s+/g, " ").trim();
  if (t.length < 20) return null;
  return clip(t, 220);
}

function isAttendeeTitle(title: string): boolean {
  return /\band\b.+\btristan\b|\btristan\b.+\band\b/i.test(title);
}

export function purposeOfCall(
  meeting: Pick<DeskMeeting, "title" | "notes" | "summary" | "campaign_name">,
  mandates: MandateBrief[],
  extraBlob = "",
): string {
  const blob = `${meeting.title ?? ""} ${meeting.summary ?? ""} ${meeting.notes ?? ""} ${meeting.campaign_name ?? ""} ${extraBlob}`;
  const yuri = mandates.some((m) => m.key === "yuri") || /yuri|\brpm\b|bioprint/i.test(blob);
  if (yuri) {
    if (/visit|tour|lab/i.test(blob)) {
      return "Purpose: Yuri RPM — the machine and any lab visit. Not a raise.";
    }
    return "Purpose: Yuri RPM customer call — how they use the machine. Not a raise.";
  }
  const named = mandates.filter((m) => m.namedByThem);
  if (named[0]) {
    return `Purpose: ${named[0].name}. ${named[0].liveQuestion}`;
  }
  if (mandates[0]) {
    return `Purpose: likely ${mandates[0].name}. ${mandates[0].liveQuestion}`;
  }
  const invite = cleanInvite(meeting.notes);
  if (invite) return `Purpose: ${invite}`;
  const title = (meeting.title ?? "").trim();
  if (title.length > 8 && !isAttendeeTitle(title)) return `Purpose: ${clip(title, 160)}`;
  return "Purpose: not written on the invite — open the briefing before you dial.";
}

export function lastMailBeat(mail: MeetingCorrespondence[]): string | null {
  if (!mail.length) return null;
  const inbound = mail.filter(
    (m) => !isYouAddress(m.from) && !/calendly@|notifications@calendly|accepted:/i.test(`${m.from} ${m.subject}`),
  );
  const outbound = mail.filter((m) => isYouAddress(m.from));
  const lastIn = inbound[0];
  const lastOut = outbound[0];
  const snip = (m: MeetingCorrespondence) => {
    let t = decodeMailText(m.snippet || m.subject || "");
    t = t
      .replace(/\b(from|to|cc|sent|date|subject)\s*:\s*[^\n]+/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const cut = t.split(/(?<=[.!?])\s+/)[0] ?? t;
    return clip(cut, 90);
  };
  const when = (m: MeetingCorrespondence) => {
    const d = m.date ? new Date(m.date) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  };
  if (lastIn && lastOut) {
    const inLater = Date.parse(lastIn.date || "0") >= Date.parse(lastOut.date || "0");
    if (inLater) {
      return `They last wrote ${when(lastIn)}: "${snip(lastIn)}"`;
    }
    return `You last wrote ${when(lastOut)}: "${snip(lastOut)}". No reply on file after that.`;
  }
  if (lastIn) return `They last wrote ${when(lastIn)}: "${snip(lastIn)}"`;
  if (lastOut) return `You last wrote ${when(lastOut)}: "${snip(lastOut)}". No reply on file.`;
  return null;
}

/** Walk back through correspondence to build a narrative of how the meeting came about. */
export function correspondenceNarrative(mail: MeetingCorrespondence[]): string | null {
  if (!mail.length) return null;

  const relevant = mail
    .filter((m) => !/calendly@|notifications@calendly|calendar-notification@/i.test(m.from ?? ""))
    .slice(0, 10);
  if (!relevant.length) return null;

  const snip = (m: MeetingCorrespondence) => {
    let t = decodeMailText(m.snippet || m.subject || "");
    t = t
      .replace(/\b(from|to|cc|sent|date|subject)\s*:\s*[^\n]+/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return clip(t, 120);
  };
  const when = (m: MeetingCorrespondence) => {
    const d = m.date ? new Date(m.date) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  };
  const who = (m: MeetingCorrespondence) =>
    isYouAddress(m.from) ? "You" : (m.from ?? "").replace(/<[^>]+>/, "").replace(/"/g, "").trim().split(/\s/)[0] || "They";

  const oldest = relevant[relevant.length - 1]!;
  const newest = relevant[0]!;
  const n = relevant.length;

  if (n === 1) {
    return `${who(oldest)} wrote ${when(oldest)}: "${snip(oldest)}"`;
  }

  const intro = isYouAddress(oldest.from)
    ? `You opened the thread ${when(oldest)}`
    : `${who(oldest)} reached out ${when(oldest)}`;

  const subjectLine = (oldest.subject ?? "").replace(/^(re|fw|fwd):\s*/i, "").trim();
  const topicBit = subjectLine ? ` re "${clip(subjectLine, 60)}"` : "";

  const lastBit = isYouAddress(newest.from)
    ? `You last wrote ${when(newest)}: "${snip(newest)}"`
    : `They last wrote ${when(newest)}: "${snip(newest)}"`;

  return `${intro}${topicBit}. ${n} messages on file. ${lastBit}`;
}

function focusFromNotes(notes: string | null | undefined): string | null {
  const t = (notes ?? "").replace(/\s+/g, " ");
  if (/women'?s-health-in-space|women'?s health in space/i.test(t)) {
    return "women's-health-in-space / hormone-driven cancer models";
  }
  if (/bioprint/i.test(t)) return "bioprinting";
  if (/future energy fund/i.test(t)) return "Future Energy Fund";
  if (/\brpm\b/i.test(t)) return "RPM user";
  return null;
}

function sectorLabel(sectors: string | null | undefined, firm: string): string | null {
  const s = (Array.isArray(sectors) ? sectors.join(" ") : String(sectors ?? "")).toLowerCase();
  const f = firm.toLowerCase();
  if (/hospital|clinical/.test(s) || /hospital/.test(f)) return "a hospital / academic health system";
  if (/academic/.test(s) || /university|dresden|usf/.test(f)) return "a university";
  if (/government|agency/.test(s) || /sck-cen|sckcen/.test(f)) {
    return "the Belgian nuclear research centre";
  }
  if (/ventures|chevron/.test(f) || /carbon capture|hydrogen|renewable/.test(s)) {
    return "a corporate venture arm";
  }
  if (s.trim()) return s.replace(/_/g, " ");
  return null;
}

/** Council template: who / organisation / purpose / last beat. Flowing prose. */
export function fourLineCheat(opts: {
  who: string;
  firm: string | null;
  role: string | null;
  notes: string | null;
  sectors: string | null;
  firmNotes: string | null;
  purpose: string;
  lastBeat: string | null;
}): string {
  const name = opts.who.trim() || "This counterpart";
  const firm = (opts.firm ?? "").trim();
  const role = (opts.role ?? "").trim();
  const notes = `${opts.notes ?? ""} ${opts.firmNotes ?? ""}`;
  const focus = focusFromNotes(notes);
  const blob = `${notes} ${name}`;

  const parts: string[] = [];

  if (role) {
    parts.push(`${name} is ${role}${firm ? ` at ${firm}` : ""}${focus ? ` — ${focus}` : ""}.`);
  } else if (/\bprofessor\b|\bprof\./i.test(blob)) {
    parts.push(`Professor ${name}${firm ? ` at ${firm}` : ""}${focus ? ` — ${focus}` : ""}.`);
  } else if (/\bdr\.?\b/i.test(blob)) {
    parts.push(`Dr ${name.replace(/^dr\.?\s+/i, "")}${firm ? ` at ${firm}` : ""}${focus ? ` — ${focus}` : ""}.`);
  } else {
    parts.push(`${name}${firm ? ` at ${firm}` : ""}${focus ? ` — ${focus}` : ""}.`);
  }

  const orgKind = sectorLabel(opts.sectors, firm);
  const firmNote = (opts.firmNotes ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 30 && !/CALL BOOKED|paternity|chased via/i.test(l));
  if (firmNote && /hospital|university|research|ventures|centre|center/i.test(firmNote)) {
    parts.push(clip(firmNote.replace(/\|.*/, ""), 140));
  } else if (firm && orgKind) {
    parts.push(`${firm} is ${orgKind}.`);
  }

  parts.push(opts.purpose.replace(/\s+/g, " ").trim());
  if (opts.lastBeat) parts.push(opts.lastBeat);

  return parts.join("\n");
}

export function personSummary(opts: {
  book: MeetingBook;
  linkedIn: LinkedInBrief | null;
  mandates: MandateBrief[];
}): string {
  const name =
    displayPersonName(opts.book.personName, opts.book.personEmail) ||
    opts.book.personName ||
    "This person";
  if (!opts.book.personId && opts.book.candidates.length > 0) {
    return `${name} is on the calendar, but more than one book row matches. Pick the right person before you treat this as filed.`;
  }
  if (!opts.book.personId) {
    return `${name} is on your calendar. The book did not return a unique person, so treat the LinkedIn and mail search as the briefing until they are filed.`;
  }
  const bits: string[] = [];
  const role = (opts.book.personRole ?? "").trim();
  const firm = (opts.book.firmName ?? "").trim();
  bits.push(
    [name, role ? `is ${role}` : "is on the book", firm ? `at ${firm}` : null]
      .filter(Boolean)
      .join(" ") + ".",
  );
  const head = (opts.linkedIn?.headline || opts.linkedIn?.snippet || "").trim();
  if (head && !bits.join(" ").toLowerCase().includes(head.slice(0, 28).toLowerCase())) {
    bits.push(clip(head, 220));
  }
  if (opts.mandates.some((m) => m.key === "yuri")) {
    bits.push("This is a Yuri / RPM conversation, not a fundraise.");
  }
  const note = (opts.book.personNotes ?? "")
    .replace(/\[\d{4}-\d{2}-\d{2} LinkedIn\][^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > 40 && note.length < 400) {
    bits.push(clip(note, 200));
  }
  return bits.join(" ");
}

export function firmSummary(opts: {
  book: MeetingBook;
  orgSnippet: string | null;
  mandates: MandateBrief[];
}): string {
  const firm = (opts.book.firmName ?? "").trim();
  if (!firm) return "No organisation is named on this slot.";
  const bits: string[] = [];
  const org = (opts.orgSnippet ?? "").trim();
  const sectors = (opts.book.firmSectors ?? "").trim();
  if (org) {
    bits.push(clip(`${firm} — ${org}`, 260));
  } else if (sectors) {
    bits.push(`${firm} (${sectors}).`);
  } else if (opts.book.firmDomain) {
    bits.push(`${firm} (${opts.book.firmDomain}).`);
  } else {
    bits.push(`${firm}.`);
  }
  if (opts.mandates.some((m) => m.key === "yuri")) {
    bits.push("They sit on the Yuri side as an RPM user, not as an investor.");
  } else if (opts.mandates[0]?.kind === "raise") {
    bits.push(`On this desk they are in the ${opts.mandates[0].name} universe.`);
  }
  const note = (opts.book.firmNotes ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 40) {
    bits.push(clip(note, 200));
  }
  return bits.join(" ");
}

export function mailNarrative(mail: MeetingCorrespondence[]): string {
  if (!mail.length) {
    return "No correspondence on file. Do not invent a prior thread.";
  }
  const subjects = mail
    .map((m) => (m.subject ?? "").replace(/^(re|fw|fwd):\s*/i, "").trim())
    .filter(Boolean);
  const topic = subjects[0] ? clip(subjects[0], 90) : null;
  const beat = lastMailBeat(mail);
  const n = mail.length;
  const head = `${n} message${n === 1 ? "" : "s"} on file${topic ? `, mainly "${topic}"` : ""}.`;
  return beat ? `${head} ${beat}` : head;
}

export function discussThisCall(
  meeting: Pick<DeskMeeting, "title" | "notes" | "summary">,
  mandates: MandateBrief[],
): string[] {
  const blob = `${meeting.title ?? ""} ${meeting.notes ?? ""} ${meeting.summary ?? ""}`;
  const items: string[] = [];
  const yuri = mandates.some((m) => m.key === "yuri") || /yuri|\brpm\b/i.test(blob);
  if (yuri) {
    items.push("This is Yuri / the RPM — not a fundraise. Do not pitch a raise.");
    items.push("How they use the RPM, and where the science and the hardware should go next.");
    if (/visit|tour|lab/i.test(blob)) {
      items.push("Lock the lab visit: who is in the room, date, and what they want you to see.");
    }
    if (/phone|call/i.test(blob)) {
      items.push("Keep this slot to the booked call. Do not reopen dropped tours unless they raise it.");
    }
  }
  for (const m of mandates) {
    if (m.key === "yuri") continue;
    items.push(m.liveQuestion);
    for (const d of m.doNotSay.slice(0, 2)) items.push(d);
  }
  if (!items.length) {
    const purpose = purposeOfCall(meeting as DeskMeeting, mandates);
    items.push(purpose);
    items.push("What they want from the time, and whether a next step is real.");
  }
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

/** Today cards: book + last mail + live calendar attendees. */
export async function loadTodayCheats(
  meetings: DeskMeeting[],
): Promise<Record<string, string>> {
  const cal = await listWeekAheadCalendar();
  const calByTime = new Map<string, string[]>();
  for (const ev of cal.events) {
    const key = ev.event_at.slice(0, 16);
    const existing = calByTime.get(key) ?? [];
    existing.push(...ev.attendee_emails);
    calByTime.set(key, existing);
  }

  const rows = await Promise.all(
    meetings.map(async (m) => {
      const calEmails = (m.event_at ? calByTime.get(m.event_at.slice(0, 16)) : null) ?? [];
      const enriched: DeskMeeting = {
        ...m,
        attendee_emails: [
          ...(m.attendee_emails ?? []),
          ...calEmails,
        ],
      };
      const book = await resolveMeetingBook(enriched);
      const extra = `${book.personNotes ?? ""} ${book.firmNotes ?? ""}`;
      const mandates = inferMandatesForMeeting(
        { ...enriched, notes: `${enriched.notes ?? ""} ${extra}` },
        null,
      );
      const allEmails = [
        ...book.searchedEmails,
        ...(book.personEmail ? [book.personEmail] : []),
        ...(enriched.attendee_emails ?? []),
      ];
      const correspondence = await loadLiveCorrespondence({
        emails: allEmails,
        personId: book.personId,
      });
      const who =
        displayPersonName(book.personName ?? m.partner_name, book.personEmail) ||
        (m.partner_name ?? m.title ?? "Meeting").trim();
      const mailBlob = correspondence.mail.map((x) => `${x.subject} ${x.snippet}`).join(" ");
      const text = fourLineCheat({
        who,
        firm: book.firmName ?? m.firm_name,
        role: book.personRole,
        notes: `${book.personNotes ?? ""} ${m.title ?? ""} ${mailBlob}`,
        sectors: book.firmSectors,
        firmNotes: book.firmNotes,
        purpose: purposeOfCall(enriched, mandates, extra),
        lastBeat: correspondenceNarrative(correspondence.mail) ?? lastMailBeat(correspondence.mail),
      });
      return [m.id, text] as const;
    }),
  );
  return Object.fromEntries(rows);
}
