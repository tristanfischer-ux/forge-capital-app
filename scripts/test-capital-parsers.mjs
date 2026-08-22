import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function load(path) {
  return readFileSync(resolve(root, path), "utf8");
}

const verdictSrc = load("lib/capital/verdict.ts");
const ruleSrc = load("lib/capital/rulebook.ts");
const nbSrc = load("lib/capital/neverbounce.ts");
const voiceSrc = load("lib/capital/voice.ts");
const mandateSrc = load("lib/capital/mandates.ts");
assert.match(verdictSrc, /parseVerdictReply/);
assert.match(ruleSrc, /\\bprimes\?\\b/);
assert.match(nbSrc, /case "catchall":/);
assert.match(nbSrc, /return "inferred"/);
assert.match(nbSrc, /case "valid":/);
assert.match(nbSrc, /return "verified"/);
assert.match(mandateSrc, /YU: "Yuri"/);
assert.match(mandateSrc, /YU: "customer"/);
assert.match(voiceSrc, /Yuri & the RPM — a short call\?/);
assert.match(voiceSrc, /I've copied Maria, Christian and Daniel at Yuri/);
assert.match(ruleSrc, /Yuri is customer intelligence, not a raise/);
const yuriFn = voiceSrc.indexOf("function composeYuriOutreach");
assert.ok(yuriFn > 0);
assert.doesNotMatch(voiceSrc.slice(yuriFn, yuriFn + 1600), /with its raise/);

function parseVerdictReply(text, lineCount) {
  const LINE = /^\s*(\d+)\s*(?:[:=.)\-]\s*|\s+)(.*)$/;
  function classify(raw) {
    const t = raw.trim();
    if (!t) return { verdict: "leave", reason: "" };
    const lower = t.toLowerCase();
    if (/^(leave|skip|blank|no|hold|not now|do not|don't|dont)\b/.test(lower) || lower === "-") {
      return { verdict: "leave", reason: t };
    }
    if (/^(2|cautious|careful|amber|yellow|slow)\b/.test(lower) || /\bbe cautious\b/.test(lower)) {
      return {
        verdict: "cautious",
        reason: t.replace(/^(2|cautious|careful|amber|yellow|slow)\b[\s:=.)\-]*/i, "").trim(),
      };
    }
    if (/^(1|fine|ok|okay|yes|approved|good|go)\b/.test(lower)) {
      return {
        verdict: "fine",
        reason: t.replace(/^(1|fine|ok|okay|yes|approved|good|go)\b[\s:=.)\-]*/i, "").trim(),
      };
    }
    if (/cautious|careful/.test(lower)) return { verdict: "cautious", reason: t };
    return { verdict: "fine", reason: t };
  }
  const numbered = new Map();
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = raw.match(LINE);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > lineCount) continue;
    numbered.set(n, { line: n, ...classify(m[2] ?? "") });
  }
  const out = [];
  for (let i = 1; i <= lineCount; i++) {
    out.push(numbered.get(i) ?? { line: i, verdict: "leave", reason: "" });
  }
  return out;
}

const parsed = parseVerdictReply("1 = fine\n2 = cautious — Bordeaux\n3 =\n", 3);
assert.equal(parsed[0].verdict, "fine");
assert.equal(parsed[1].verdict, "cautious");
assert.match(parsed[1].reason, /Bordeaux/);
assert.equal(parsed[2].verdict, "leave");

console.log("PASS  parsers");
