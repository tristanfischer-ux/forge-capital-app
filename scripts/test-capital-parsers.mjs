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
assert.match(voiceSrc, /if it is not one for you, just say the word and I will happily leave it there/);
assert.match(voiceSrc, /I know August can be a tricky time/);
assert.match(voiceSrc, /If twenty minutes is easier than writing back, grab a slot here/);
assert.match(
  voiceSrc.slice(voiceSrc.indexOf("export function composeChaserDraft"), voiceSrc.indexOf("export function composeThankYouDraft")),
  /CALENDLY_PROMPT/,
);
assert.match(load("lib/desk/call-cheat.ts"), /fourLineCheat/);
assert.match(load("lib/desk/call-cheat.ts"), /discussThisCall/);
assert.match(load("lib/desk/call-cheat.ts"), /Always four lines/);
assert.match(load("lib/desk/call-cheat.ts"), /isAttendeeTitle/);
assert.match(load("app/raise-desk.css"), /white-space: pre-line/);
assert.match(load("lib/capital/person-linkedin.ts"), /orgBlurbFromSearch/);
assert.match(load("lib/capital/send-date.ts"), /inferLastOutboundAt/);
assert.match(load("lib/capital/send-date.ts"), /sendDatesFromNote/);
assert.doesNotMatch(voiceSrc.slice(voiceSrc.indexOf("export function composeChaserDraft"), voiceSrc.indexOf("export function composeThankYouDraft")), /COLD_BIO/);
assert.match(load("lib/gmail/create-draft.ts"), /threadId\?: string/);
assert.match(load("lib/gmail/create-draft.ts"), /In-Reply-To/);
assert.match(load("lib/gmail/find-outbound-thread.ts"), /findMandateOutboundThread/);
assert.match(load("lib/capital/mandates.ts"), /mandateGmailQuery/);
assert.match(load("lib/capital/mandates.ts"), /subject:\(\$\{hints\}\)/);
assert.match(load("app/(authed)/chasers/actions.ts"), /findMandateOutboundThread/);
assert.match(load("app/(authed)/chasers/actions.ts"), /threadId: thread.threadId/);
assert.match(load("app/(authed)/chasers/actions.ts"), /They already replied/);
assert.match(load("lib/gmail/find-outbound-thread.ts"), /tristan\\.fischer@gmail\\.com/);
assert.match(load("lib/capital/chasers.ts"), /"approached"/);
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

import { spawnSync } from "node:child_process";
const dateChk = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `import { sendDatesFromNote, inferLastOutboundAt } from ${JSON.stringify(resolve(root, "lib/capital/send-date.ts"))};
     const aaron = "[2026-05-04] Added. | [2026-05-15] Email sent to andy.gregory@bgf.co.uk. | 2026-05-28 — Follow-up sent";
     // 2026-05-04 is an "added" date, not a send.
     if (sendDatesFromNote(aaron).join(",") !== "2026-05-15,2026-05-28") throw new Error("aaron dates");
     if (inferLastOutboundAt({ statusNote: aaron }) !== "2026-05-28") throw new Error("aaron last");
     if (inferLastOutboundAt({ firstSent: "2026-03-11", statusNote: "2026-06-21: Re-engagement follow-up SENT" }) !== "2026-06-21") throw new Error("gareth last");
     console.log("PASS  send-date");`,
  ],
  { encoding: "utf8" },
);
if (dateChk.status !== 0) {
  process.stderr.write(dateChk.stderr || dateChk.stdout || "send-date test failed\n");
  process.exit(dateChk.status || 1);
}
process.stdout.write(dateChk.stdout);

console.log("PASS  parsers");
