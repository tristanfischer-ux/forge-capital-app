import {
  counterpartFromTitle,
  emailsFromBlob,
  firmHintFromTitle,
  guestEmails,
} from "@/lib/desk/calendar-name";
import { MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";
import { matchFirm } from "@/lib/capital/rpc";
import { searchBook } from "@/lib/capital/search-book";
import type { DeskMeeting } from "@/lib/queries/desk-today";
import {
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";
import { inChunks } from "@/lib/supabase/in-chunks";

export type MeetingCandidate = {
  personId: string;
  personName: string;
  email: string | null;
  firmName: string | null;
  score: number;
};

export type MeetingProgramme = {
  code: MandateCode;
  label: string;
  stage: string;
  latestTouch: string | null;
  statusNote: string | null;
};

export type MeetingBook = {
  personId: string | null;
  personName: string | null;
  personEmail: string | null;
  personRole: string | null;
  personEmailState: string | null;
  personDnc: boolean;
  personNotes: string | null;
  linkedinUrl: string | null;
  firmId: string | null;
  firmName: string | null;
  firmDomain: string | null;
  firmSectors: string | null;
  firmNotes: string | null;
  programmes: MeetingProgramme[];
  lastTouch: string | null;
  candidates: MeetingCandidate[];
  searchedEmails: string[];
  searchedNames: string[];
  unmatched: boolean;
};

const EMPTY: MeetingBook = {
  personId: null,
  personName: null,
  personEmail: null,
  personRole: null,
  personEmailState: null,
  personDnc: false,
  personNotes: null,
  linkedinUrl: null,
  firmId: null,
  firmName: null,
  firmDomain: null,
  firmSectors: null,
  firmNotes: null,
  programmes: [],
  lastTouch: null,
  candidates: [],
  searchedEmails: [],
  searchedNames: [],
  unmatched: true,
};

type PersonRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  email_state: string | null;
  dnc: boolean | null;
  role_title: string | null;
  firm_id: string | null;
  notes: string | null;
  linkedin_url: string | null;
};

export function displayPersonName(name: string | null | undefined, email?: string | null): string {
  let n = (name ?? "").replace(/\s+/g, " ").trim();
  if (email) n = n.replace(email, "").replace(/\s+/g, " ").trim();
  n = n.replace(/[\w.+-]+@[\w.-]+/g, "").replace(/\s+/g, " ").trim();
  return n || (name ?? "").trim();
}

function clip(s: string | null | undefined, max = 420): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function sectorsLine(sectors: unknown): string | null {
  if (!Array.isArray(sectors)) return null;
  const bits = sectors.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
  return bits.length ? bits.join(", ") : null;
}

export async function resolveMeetingBook(meeting: DeskMeeting): Promise<MeetingBook> {
  if (!capitalConfigured()) {
    const name = counterpartFromTitle(meeting.title) ?? meeting.partner_name;
    return {
      ...EMPTY,
      personName: name,
      firmName: firmHintFromTitle(meeting.title) ?? meeting.firm_name,
      searchedEmails: guestEmails(meeting.attendee_emails),
      searchedNames: name ? [name] : [],
    };
  }

  const emails = guestEmails([
    ...(meeting.attendee_emails ?? []),
    ...emailsFromBlob(meeting.title, meeting.partner_name, meeting.notes, meeting.summary, meeting.firm_name),
  ]);
  const rawName =
    counterpartFromTitle(meeting.title) ??
    (typeof meeting.partner_name === "string" && meeting.partner_name.trim()
      ? meeting.partner_name.trim()
      : null);
  const nameHint = displayPersonName(rawName, emails[0] ?? null) || rawName;
  const firmHint =
    firmHintFromTitle(meeting.title) ??
    (meeting.firm_name && meeting.firm_name.trim() ? meeting.firm_name.trim() : null);

  const core = createCoreClient();
  let person: PersonRow | null = null;
  const candidates: MeetingCandidate[] = [];
  const personCols =
    "id, full_name, email, email_state, dnc, role_title, firm_id, notes, linkedin_url";

  for (const email of emails) {
    const { data } = await core.from("people").select(personCols).ilike("email", email).maybeSingle();
    if (data?.id) {
      person = data as PersonRow;
      break;
    }
  }

  if (!person && nameHint) {
    const { data: named } = await core
      .from("people")
      .select(personCols)
      .ilike("full_name", `%${nameHint}%`)
      .limit(8);
    const rows = (named ?? []) as PersonRow[];
    const exact = rows.filter((p) => {
      const n = displayPersonName(p.full_name, p.email).toLowerCase();
      return n === nameHint.toLowerCase() || n.startsWith(nameHint.toLowerCase() + " ");
    });
    if (exact.length === 1) {
      person = exact[0];
    } else if (rows.length === 1) {
      person = rows[0];
    } else if (exact.length > 1) {
      for (const p of exact.slice(0, 5)) {
        candidates.push({
          personId: p.id,
          personName: p.full_name ?? nameHint,
          email: p.email,
          firmName: null,
          score: 80,
        });
      }
    }
  }

  if (!person && nameHint && candidates.length === 0) {
    const hits = await searchBook(nameHint);
    const people = hits.filter((h) => h.kind === "person");
    const top = people[0];
    const second = people[1];
    if (top && (!second || top.score - second.score >= 10)) {
      const { data } = await core.from("people").select(personCols).eq("id", top.id).maybeSingle();
      if (data?.id) person = data as PersonRow;
    } else {
      for (const h of people.slice(0, 5)) {
        candidates.push({
          personId: h.id,
          personName: h.label,
          email: null,
          firmName: h.sub,
          score: h.score,
        });
      }
    }
  }

  let firmId = person?.firm_id ?? null;
  let firmName: string | null = null;
  let firmDomain: string | null = null;
  let firmSectors: string | null = null;
  let firmNotes: string | null = null;

  if (!firmId && firmHint) {
    const matched = await matchFirm(firmHint);
    if (matched.match?.firm_id) firmId = matched.match.firm_id;
    if (!firmId) {
      const hits = await searchBook(firmHint);
      const firm = hits.find((h) => h.kind === "firm");
      if (firm) firmId = firm.id;
    }
  }

  if (firmId) {
    const { data: firm } = await core
      .from("firms")
      .select("id, canonical_name, website_domain, sectors, notes, dnc")
      .eq("id", firmId)
      .maybeSingle();
    if (firm) {
      firmName = firm.canonical_name;
      firmDomain = firm.website_domain;
      firmSectors = sectorsLine(firm.sectors);
      firmNotes = clip(firm.notes, 360);
    }
  }

  const programmes: MeetingProgramme[] = [];
  let lastTouch: string | null = null;
  if (person?.id) {
    const engage = createEngageClient();
    const { data: parts } = await engage
      .from("participations")
      .select("stage, latest_touch, first_sent, status_note, mandate_id")
      .eq("person_id", person.id)
      .limit(20);
    const mandateIds = [
      ...new Set((parts ?? []).map((p) => p.mandate_id).filter(Boolean)),
    ] as string[];
    const mandates = mandateIds.length
      ? await inChunks(mandateIds, async (chunk) => {
          const { data } = await engage.from("mandates").select("id, code").in("id", chunk);
          return data ?? [];
        })
      : [];
    const codeBy = Object.fromEntries(
      mandates.map((m) => [m.id, String(m.code).toUpperCase()]),
    );
    for (const p of parts ?? []) {
      const code = codeBy[p.mandate_id ?? ""] as MandateCode | undefined;
      if (!code || !MANDATE_LABEL[code]) continue;
      const touch = p.latest_touch || p.first_sent || null;
      if (touch && (!lastTouch || touch > lastTouch)) lastTouch = touch;
      programmes.push({
        code,
        label: MANDATE_LABEL[code],
        stage: p.stage ?? "",
        latestTouch: touch,
        statusNote: clip(p.status_note, 180),
      });
    }
  }

  return {
    personId: person?.id ?? null,
    personName: person?.full_name ?? nameHint,
    personEmail: person?.email ?? emails[0] ?? null,
    personRole: person?.role_title ?? null,
    personEmailState: person?.email_state ?? null,
    personDnc: Boolean(person?.dnc),
    personNotes: clip(person?.notes, 420),
    linkedinUrl: person?.linkedin_url ?? null,
    firmId,
    firmName: firmName ?? firmHint,
    firmDomain,
    firmSectors,
    firmNotes,
    programmes,
    lastTouch,
    candidates,
    searchedEmails: emails,
    searchedNames: nameHint ? [nameHint] : [],
    unmatched: !person?.id,
  };
}

export function personBlurb(book: MeetingBook): string {
  if (!book.personId) {
    if (book.candidates.length > 0) {
      return `More than one person on the book matches this name. Pick the right row rather than guessing.`;
    }
    if (book.personName) {
      return `${book.personName} is on your calendar. The book did not return a unique row for that name${book.searchedEmails.length ? ` or ${book.searchedEmails.join(", ")}` : ""}.`;
    }
    return "No named person on this slot yet.";
  }
  const bits: string[] = [];
  if (book.personRole) bits.push(book.personRole);
  const name = (book.personName ?? "").toLowerCase();
  if (book.personEmail && !name.includes(book.personEmail.toLowerCase())) {
    bits.push(book.personEmail);
  }
  if (book.programmes.length) {
    bits.push(
      book.programmes
        .map((p) => {
          const when = p.latestTouch ? p.latestTouch.slice(0, 10) : "no dated touch";
          return `${p.label} · ${p.stage || "no stage"} · ${when}`;
        })
        .join("; "),
    );
  } else if (book.lastTouch) {
    bits.push(`Last dated touch ${book.lastTouch.slice(0, 10)}.`);
  }
  if (book.personNotes) bits.push(book.personNotes);
  return bits.join(". ") || "On the book, with no role or notes stored yet.";
}

export function firmBlurb(book: MeetingBook): string {
  if (!book.firmId) {
    if (book.firmName) {
      return `${book.firmName} is named on the invite. The book did not return a unique firm row.`;
    }
    return "No firm on this slot yet.";
  }
  const bits: string[] = [];
  if (book.firmDomain) bits.push(book.firmDomain);
  if (book.firmSectors) bits.push(book.firmSectors);
  if (book.firmNotes) bits.push(book.firmNotes);
  return bits.join(". ") || "On the book, with no sector or notes stored yet.";
}
