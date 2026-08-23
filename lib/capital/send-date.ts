/**
 * The tracker often recorded a send in status_note prose without writing
 * first_sent / latest_touch. Recover a real date from those fields.
 */

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const SENT_HINT =
  /email sent|e-?mail sent|follow-?up sent|outreach sent|re-outreach|re-engagement|actually sent|sent to|sent \(|— sent|SENT to|SENT \(/i;

function pad(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

function toIso(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(String(m))}-${pad(String(d))}`;
}

function parseLooseDate(raw: string, fallbackYear: number): string | null {
  const iso = raw.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return toIso(iso[1], iso[2], iso[3]);
  const loose = raw.match(
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+(20\d{2}))?/i,
  );
  if (!loose) return null;
  const month = MONTHS[loose[2].slice(0, 3).toLowerCase()];
  const year = loose[3] ?? String(fallbackYear);
  return month ? toIso(year, month, loose[1]) : null;
}

function nearSent(window: string): boolean {
  return SENT_HINT.test(window);
}

/** ISO dates in the note that sit next to a send/follow-up phrase. */
export function sendDatesFromNote(note: string | null | undefined): string[] {
  if (!note) return [];
  const yearMatch = note.match(/20\d{2}/);
  const fallbackYear = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();
  const found = new Set<string>();
  const push = (iso: string | null) => {
    if (iso) found.add(iso);
  };
  // Notes are pipe-separated clauses. Do not let an "added on" date
  // inherit "Email sent" from the next clause.
  const clauses = note.split(/\s*\|\s*/);

  for (const clause of clauses) {
    if (!nearSent(clause)) continue;
    for (const m of clause.matchAll(/20\d{2}-\d{2}-\d{2}/g)) {
      push(m[0]);
    }
    for (const m of clause.matchAll(
      /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+20\d{2})?/gi,
    )) {
      push(parseLooseDate(m[0], fallbackYear));
    }
  }
  return [...found].sort();
}

function asDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Last proven outbound day: activity, latest_touch, first_sent, or the note. */
export function inferLastOutboundAt(opts: {
  activityAt?: string | null;
  firstSent?: string | null;
  latestTouch?: string | null;
  statusNote?: string | null;
}): string | null {
  const fromNote = sendDatesFromNote(opts.statusNote);
  const candidates = [
    asDay(opts.activityAt),
    asDay(opts.latestTouch),
    asDay(opts.firstSent),
    fromNote[fromNote.length - 1] ?? null,
  ].filter((x): x is string => Boolean(x));
  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

export function inferFirstSentAt(opts: {
  firstSent?: string | null;
  statusNote?: string | null;
}): string | null {
  const existing = asDay(opts.firstSent);
  if (existing) return existing;
  const fromNote = sendDatesFromNote(opts.statusNote);
  return fromNote[0] ?? null;
}
