/** Checkable Block 3 only. Empty means needs research — never invent a portfolio. */

export function thesisFromBook(opts: {
  firmName: string;
  sectors: string | null;
  notes: string | null;
  instruction?: string | null;
}): { thesisLine: string | null; subjectHook: string | null; source: string | null } {
  const sectors = (opts.sectors ?? "").trim();
  const notes = (opts.notes ?? "").replace(/\s+/g, " ").trim();
  const named = notes.match(/\b([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,3})\b/g);
  const portfolioHint = (named ?? []).find(
    (n) =>
      n.length > 3 &&
      !/^(The|And|From|Call|Dear|Best|Tristan|LinkedIn)$/i.test(n) &&
      notes.toLowerCase().includes(n.toLowerCase()) &&
      /portfolio|backed|invested|holdings|fund/i.test(notes),
  );
  if (portfolioHint) {
    return {
      thesisLine: `From what I have read, ${opts.firmName} has already been around ${portfolioHint} — if that reading is right, the company below may sit next to that work.`,
      subjectHook: sectors.split(",")[0]?.trim() || portfolioHint,
      source: `notes · ${portfolioHint}`,
    };
  }
  if (sectors) {
    const first = sectors.split(",")[0]?.trim();
    return {
      thesisLine: `From what I have read, ${opts.firmName} looks at ${sectors}. If that is right, the company below may fit.`,
      subjectHook: first || null,
      source: `sectors · ${sectors}`,
    };
  }
  return { thesisLine: null, subjectHook: null, source: null };
}
