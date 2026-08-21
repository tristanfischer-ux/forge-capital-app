export type VerdictKind = "fine" | "cautious" | "leave";

export type ParsedVerdict = {
  line: number;
  verdict: VerdictKind;
  reason: string;
};

const LINE = /^\s*(\d+)\s*(?:[:=.)\-]\s*|\s+)(.*)$/;

function classify(raw: string): { verdict: VerdictKind; reason: string } {
  const text = raw.trim();
  if (!text) return { verdict: "leave", reason: "" };
  const lower = text.toLowerCase();
  if (
    /^(leave|skip|blank|no|hold|not now|do not|don't|dont)\b/.test(lower) ||
    lower === "-"
  ) {
    return { verdict: "leave", reason: text };
  }
  if (/^(2|cautious|careful|amber|yellow|slow)\b/.test(lower) || /\bbe cautious\b/.test(lower)) {
    const reason = text.replace(/^(2|cautious|careful|amber|yellow|slow)\b[\s:=.)\-]*/i, "").trim();
    return { verdict: "cautious", reason };
  }
  if (/^(1|fine|ok|okay|yes|approved|good|go)\b/.test(lower)) {
    const reason = text.replace(/^(1|fine|ok|okay|yes|approved|good|go)\b[\s:=.)\-]*/i, "").trim();
    return { verdict: "fine", reason };
  }
  if (/cautious|careful/.test(lower)) return { verdict: "cautious", reason: text };
  return { verdict: "fine", reason: text };
}

/**
 * Parse a principal's reply.
 * Handles:
 *   1 = fine
 *   2 = cautious — met them in Bordeaux
 *   3 =
 *   all fine except Bpifrance — geography
 */
export function parseVerdictReply(text: string, lineCount: number): ParsedVerdict[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const numbered = new Map<number, ParsedVerdict>();
  for (const raw of lines) {
    const m = raw.match(LINE);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > lineCount) continue;
    const classified = classify(m[2] ?? "");
    numbered.set(n, { line: n, ...classified });
  }

  const except = text.match(/all fine except\s+(.+)/i);
  if (except && numbered.size === 0) {
    return [];
  }

  const out: ParsedVerdict[] = [];
  for (let i = 1; i <= lineCount; i++) {
    const hit = numbered.get(i);
    if (hit) out.push(hit);
    else out.push({ line: i, verdict: "leave", reason: "" });
  }

  if (numbered.size === 0) {
    const allFine = /^\s*all fine\b/i.test(text.trim());
    if (allFine) {
      const exceptBlob = except?.[1] ?? "";
      return out.map((row) => ({ ...row, verdict: "fine", reason: exceptBlob }));
    }
  }
  return out;
}

export function stageForVerdict(verdict: VerdictKind, current: string | null): string {
  if (verdict === "fine" || verdict === "cautious") return "approved";
  return current && current !== "awaiting_signoff" ? current : "research";
}
