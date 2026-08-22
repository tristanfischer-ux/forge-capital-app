/** Parse a calendar title into a counterpart name and optional firm hint. Never invent. */

const SELF = /\btristan(?:\s+fischer)?\b/i;

export function counterpartFromTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const andSelf = t.match(/^(.+?)\s+and\s+tristan(?:\s+fischer)?\s*$/i);
  if (andSelf) return cleanName(andSelf[1]);

  const selfAnd = t.match(/^tristan(?:\s+fischer)?\s+and\s+(.+)$/i);
  if (selfAnd) return cleanName(stripTrailingFirm(selfAnd[1]));

  const paren = t.match(/^([^(]{3,80}?)\s*\(([^)]+)\)\s*$/);
  if (paren && !SELF.test(paren[1])) return cleanName(paren[1]);

  const split = t.split(/\s+[—–\-|/]\s+/);
  if (split.length >= 2 && !SELF.test(split[0] ?? "") && wordCount(split[0] ?? "") <= 5) {
    return cleanName(split[0]);
  }

  const stripped = t
    .replace(/\b(google meet|zoom|microsoft teams|sync|call|meeting)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    stripped &&
    !SELF.test(stripped) &&
    wordCount(stripped) <= 5 &&
    /[A-Za-z]/.test(stripped)
  ) {
    return cleanName(stripTrailingFirm(stripped));
  }
  return null;
}

export function firmHintFromTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const paren = t.match(/\(([^)]{2,80})\)/);
  if (paren?.[1] && !SELF.test(paren[1])) return paren[1].trim();
  const split = t.split(/\s+[—–\-|/]\s+/);
  if (split.length >= 2) {
    const rest = split
      .slice(1)
      .join(" ")
      .replace(/\band\s+tristan(?:\s+fischer)?.*$/i, "")
      .trim();
    if (rest && !SELF.test(rest) && rest.length >= 2) return rest;
  }
  return null;
}

export function emailsFromBlob(...blobs: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const blob of blobs) {
    const hits = String(blob ?? "").match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? [];
    found.push(...hits);
  }
  return guestEmails(found);
}

export function guestEmails(
  emails: string[] | null | undefined,
  extraSelf: string[] = [],
): string[] {
  const self = new Set(
    ["tristan.fischer@gmail.com", ...extraSelf].map((e) => e.trim().toLowerCase()),
  );
  const out: string[] = [];
  for (const raw of emails ?? []) {
    const e = raw.trim().toLowerCase();
    if (!e.includes("@")) continue;
    if (self.has(e)) continue;
    if (e.endsWith("@resource.calendar.google.com")) continue;
    if (e.includes("calendar.google.com")) continue;
    if (e.endsWith("@group.calendar.google.com")) continue;
    out.push(e);
  }
  return [...new Set(out)];
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function stripTrailingFirm(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function cleanName(s: string | null | undefined): string | null {
  const n = stripTrailingFirm((s ?? "").replace(/["']/g, "")).trim();
  if (n.length < 3 || SELF.test(n)) return null;
  if (/^(canceled|cancelled):/i.test(n)) return null;
  return n;
}
