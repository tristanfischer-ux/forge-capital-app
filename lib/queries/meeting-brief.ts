import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface MeetingCorrespondence {
  id: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface MeetingBriefFile {
  partner_id: number | null;
  firm_id: number | null;
  firm_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_partner_id: string | null;
  correspondence: MeetingCorrespondence[];
  brief: {
    who?: string;
    firm?: string;
    why_this_call?: string;
    how_they_arrived?: string;
    focus?: string[];
    raise?: string;
    email_story?: string;
  };
  generated_at: string;
}

export function correspondenceTime(m: MeetingCorrespondence): number {
  const t = Date.parse(m.date);
  return Number.isFinite(t) ? t : 0;
}

export function sortCorrespondenceNewestFirst(
  mail: MeetingCorrespondence[],
): MeetingCorrespondence[] {
  return [...mail].sort((a, b) => correspondenceTime(b) - correspondenceTime(a));
}

export function gmailOpenHref(mail: MeetingCorrespondence): string {
  const thread = mail.threadId || mail.id;
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(thread)}`;
}

export function loadMeetingBriefs(): Record<string, MeetingBriefFile> {
  const file = join(process.cwd(), "data/meeting-briefs.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, MeetingBriefFile>;
  } catch {
    return {};
  }
}

export function briefForMeetingId(
  briefs: Record<string, MeetingBriefFile>,
  id: string,
): MeetingBriefFile | null {
  return (
    briefs[id] ??
    briefs[`gcal:${id}`] ??
    briefs[id.replace(/^gcal:/, "")] ??
    null
  );
}

export function decodeMailText(s: string): string {
  return s
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const MAIL_NOISE =
  /calendly@|notifications@calendly|boardy@boardy|accepted:|invitation from an unknown sender|reacted to your message|out of office|automatic reply/i;

export function isYouAddress(s: string): boolean {
  return /tristan\.fischer@|tristan fischer/i.test(s);
}

export function mailDisplayName(header: string): string {
  const named = header.match(/^"?([^"<]+)"?\s*</);
  if (named?.[1]?.trim()) return named[1].trim();
  const email = header.match(/[\w.+-]+@[\w.-]+/);
  return email ? email[0] : header.trim();
}

export function formatMailDate(date: string): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatMailSnippet(s: string, max = 180): string {
  const t = decodeMailText(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

export function isUsefulCorrespondence(m: MeetingCorrespondence): boolean {
  const blob = `${m.from} ${m.subject} ${m.snippet}`;
  if (MAIL_NOISE.test(blob)) return false;
  return Boolean(decodeMailText(m.snippet || "").trim() || decodeMailText(m.subject || "").trim());
}

/** Newest inbound + newest outbound, then extras, shown oldest-first. */
export function pickCorrespondence(
  mail: MeetingCorrespondence[],
  limit = 3,
): MeetingCorrespondence[] {
  const useful = mail.filter(isUsefulCorrespondence);
  const inbound = useful.filter((m) => !isYouAddress(m.from));
  const outbound = useful.filter((m) => isYouAddress(m.from));
  const picked: MeetingCorrespondence[] = [];
  if (inbound[0]) picked.push(inbound[0]);
  if (outbound[0]) picked.push(outbound[0]);
  for (const m of useful) {
    if (picked.length >= limit) break;
    if (!picked.includes(m)) picked.push(m);
  }
  return picked.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || 0);
}

export function mailDirection(m: MeetingCorrespondence): string {
  const from = isYouAddress(m.from) ? "You" : mailDisplayName(m.from);
  const toFirst = (m.to || "").split(",")[0] ?? "";
  const to = isYouAddress(toFirst) ? "You" : mailDisplayName(toFirst) || "—";
  return `${formatMailDate(m.date)} · ${from} → ${to}`;
}

export function correspondenceLooksCanceled(mail: MeetingCorrespondence[]): boolean {
  return mail.some((m) => /canceled|cancelled/i.test(`${m.subject} ${m.snippet}`));
}

export function loadMeetingNotes(): Record<string, { text: string; updated_at: string }> {
  const file = join(process.cwd(), "data/meeting-notes.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      { text: string; updated_at: string }
    >;
  } catch {
    return {};
  }
}

export function saveMeetingNote(id: string, text: string) {
  const file = join(process.cwd(), "data/meeting-notes.json");
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const all = loadMeetingNotes();
  all[id] = { text, updated_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(all, null, 2));
}
