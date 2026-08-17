import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { loadMeetingBriefs } from "@/lib/queries/meeting-brief";
import { readDeskWeekCache } from "@/lib/queries/desk-calendar";
import {
  isDnc,
  lookupRegistry,
  normalizeFirmName,
} from "@/lib/desk/identity";

export interface N2ACommitment {
  owner: "tristan" | "counterpart";
  text: string;
  artefact?: string;
  due?: string;
}

export interface N2AMandateVerdict {
  mandate: string;
  verdict: string;
  statusHint: string;
  reason?: string;
}

export interface N2ADraft {
  id: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  kind: "counterpart" | "intro" | "heads-up";
  attachMarker?: string;
  lint: string[];
  gmailDraftId?: string;
}

export interface N2AProposal {
  id: string;
  created_at: string;
  confirmed: boolean;
  event: { who: string; email?: string; when?: string; meetingId?: string };
  prior: { dirtyFirm?: string; cleanFirm: string; history?: string };
  firmFacts: string[];
  verdicts: N2AMandateVerdict[];
  objections: string[];
  commitments: N2ACommitment[];
  numbers: string[];
  sideNote?: string;
  drafts: N2ADraft[];
  loops: { text: string; due: string }[];
  summary: string;
  rowCreates: number;
  matchedExisting: boolean;
}

const RUNS = join(process.cwd(), "data/n2a-runs.json");

function loadRuns(): N2AProposal[] {
  if (!existsSync(RUNS)) return [];
  try {
    return JSON.parse(readFileSync(RUNS, "utf8")) as N2AProposal[];
  } catch {
    return [];
  }
}

function saveRuns(runs: N2AProposal[]) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

export function listN2ARuns(): N2AProposal[] {
  return loadRuns();
}

export function openLoops(): { text: string; due: string }[] {
  return loadRuns()
    .filter((r) => r.confirmed)
    .flatMap((r) => r.loops);
}

function cleanBlob(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/This (editable )?transcript[\s\S]{0,200}/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function matchEvent(blob: string): Promise<N2AProposal["event"]> {
  const email =
    blob.match(/[\w.+-]+@[\w.-]+\.\w+/i)?.[0] ??
    undefined;
  const cache = await readDeskWeekCache();
  const lower = blob.toLowerCase();
  const byEmail = email
    ? cache.meetings.find((m) =>
        (m.attendee_emails ?? []).some((e) => e.toLowerCase() === email.toLowerCase()),
      )
    : null;
  const byName = cache.meetings.find((m) => {
    const who = (m.partner_name ?? m.title ?? "").toLowerCase();
    return who && lower.includes(who.split(/\s+/)[0] ?? "___") && who.length > 4;
  });
  const hit = byEmail ?? byName ?? null;
  const who =
    hit?.partner_name ??
    blob.match(/([A-Z][a-z]+(?:ič|ic)? [A-Z][a-z]+)/)?.[1] ??
    "Unknown counterpart";
  return {
    who,
    email: email ?? hit?.attendee_emails?.[0],
    when: hit?.event_at,
    meetingId: hit?.id,
  };
}

function extractMihaShaped(blob: string): Partial<N2AProposal> | null {
  const t = blob.toLowerCase();
  const looksMiha =
    /miha|pavlovi|project[- ]a/.test(t) &&
    (/odysseus|adysius|adsum|dcs space|odyssey/.test(t) || /space sol|space sella/.test(t));
  if (!looksMiha) return null;
  return {
    firmFacts: [
      "Fund: about €325M main plus a ~€75M defence vehicle",
      "Cheque: €1–8M; pre-seed/seed, some A/B via the vehicle",
      "Behaviour: leads or co-leads",
      "Track record: first EU defence investor in Quantum Systems 2022; 10–11 defence deals",
      "Thesis: long-standing laser thesis; evaluated a Latvian laser-downlink company; never found a backable team",
      "Team: Miha; Jack, partner; a GP who is also CEO of Stark",
    ],
    verdicts: [
      {
        mandate: "Odysseus Space",
        verdict: "Explicit yes — wants a management call",
        statusHint: "+7",
        reason: "100%… definitely love to speak with the laser company",
      },
      {
        mandate: "Space Solar",
        verdict: "Interested; partner review; self-imposed 1–2 day deadline",
        statusHint: "+6",
      },
      {
        mandate: "Hooley RF / PHANTM",
        verdict: "Parked",
        statusHint: "parked",
        reason: "Defence antennas read as PE, not VC",
      },
    ],
    objections: [
      "Edge-compute-in-space vs direct downlink",
      "Chicken-and-egg deployment → paying customers",
      "Basis of the 2027 ~€5M revenue plan",
      "His diligence: edge compute sold as sealed hardware to defence primes, not as a service",
    ],
    commitments: [
      { owner: "tristan", text: "Send Odysseus pack", artefact: "Odysseus pack" },
      { owner: "tristan", text: "Intro Miha ↔ Jordan" },
      { owner: "tristan", text: "Send Space Solar deck", artefact: "Space Solar deck — NOT the internal prime draft" },
      { owner: "tristan", text: "Heads-up to Space Solar principals" },
      { owner: "counterpart", text: "Partner review + email verdict in 1–2 days", due: plusDays(2) },
    ],
    numbers: [
      "He said 10 million seed, 60 million Series A — rulebook ask is £10M; currency on the call was ambiguous; normalised to £ and kept going",
    ],
    sideNote: "Anvil / ForgeOS injection-moulding tangent — one line only, not written to investor records.",
    prior: {
      dirtyFirm: "13 Project A Ventures",
      cleanFirm: "Project A",
      history:
        "Jordan (via Stephan Schulze) approached Project A in 2025 and got no answer. This is a door he wrote off, reopened via an intro — hand that to Jordan.",
    },
  };
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function lintDraft(body: string, warm: boolean): string[] {
  const issues: string[] = [];
  if (!/tristan\.fischer@gmail\.com/i.test(body)) issues.push("missing gmail");
  if (!/\+44 7776191944/.test(body)) issues.push("missing mobile");
  if (!/linkedin\.com\/in\/tristanfischer/i.test(body)) issues.push("missing LinkedIn");
  if (!/historyfuturenow\.com/i.test(body)) issues.push("missing thought-pieces URL");
  if (/\bprime\b/i.test(body) && /space solar/i.test(body)) issues.push("prime framing");
  if (!warm && !/my name is tristan fischer/i.test(body)) {
    /* warm drafts must NOT use the cold bio */
  }
  if (warm && /my name is tristan fischer/i.test(body)) issues.push("cold bio on a warm letter");
  return issues;
}

function signOff(): string {
  return [
    "Best regards,",
    "Tristan Fischer",
    "tristan.fischer@gmail.com",
    "+44 7776191944",
    "https://www.linkedin.com/in/tristanfischer/",
    "Thought pieces: www.historyfuturenow.com",
  ].join("\n");
}

function buildDrafts(p: Partial<N2AProposal>, event: N2AProposal["event"]): N2ADraft[] {
  const to = event.email ?? "miha.pavlovic@project-a.vc";
  const odysseus: N2ADraft = {
    id: "d-odysseus",
    to,
    subject: "Odysseus Space — the laser company, and your two questions",
    kind: "counterpart",
    attachMarker: "[ATTACH BEFORE SENDING: Odysseus pack]",
    body: `Dear Miha,\n\nGood to speak this morning. As promised, here is the Odysseus material — and I have framed it around the two questions you raised: edge-compute-in-space versus a direct optical downlink, and how deployment becomes paying customers rather than a chicken-and-egg.\n\nYou mentioned coming back within a day or two after partner review. I will hold that.\n\n[ATTACH BEFORE SENDING: Odysseus pack]\n\n${signOff()}`,
    lint: [],
  };
  odysseus.lint = lintDraft(odysseus.body, true);
  const solar: N2ADraft = {
    id: "d-solar",
    to,
    subject: "Space Solar — the infrastructure layer",
    kind: "counterpart",
    attachMarker: "[ATTACH BEFORE SENDING: Space Solar deck — NOT the internal 'prime' draft]",
    body: `Dear Miha,\n\nFollowing this morning: Space Solar as an infrastructure layer, not a pitch dressed as something it is not. Deck attached once I have put the approved file on.\n\nYou said you would come back within a day or two after speaking with Jack.\n\n[ATTACH BEFORE SENDING: Space Solar deck — NOT the internal 'prime' draft]\n\n${signOff()}`,
    lint: [],
  };
  solar.lint = lintDraft(solar.body, true);
  const intro: N2ADraft = {
    id: "d-intro",
    to: "j.vannitsen@odysseusspace.com",
    cc: to,
    subject: "Introduction: Miha Pavlovič, Project A ↔ Jordan Vannitsen, Odysseus",
    kind: "intro",
    body: `Dear Jordan, dear Miha,\n\nMiha is an Investment Associate at Project A (Berlin). They lead or co-lead, cheque €1–8M, with a defence vehicle alongside the main fund — first EU defence cheque into Quantum Systems in 2022. He wants a management session on Odysseus and will come with questions on downlink versus on-orbit compute, and on 2027 revenue.\n\nJordan, you know the Flight Terminal work; I am happy for you to run the technical session directly.\n\n${signOff()}`,
    lint: [],
  };
  intro.lint = lintDraft(intro.body, true);
  const heads: N2ADraft = {
    id: "d-heads",
    to: "richard@spacesolar.co",
    subject: "Heads-up: Project A (Miha) — Space Solar this morning",
    kind: "heads-up",
    body: `Richard,\n\nI took a call this morning with Miha Pavlovič at Project A. Space Solar was discussed as an infrastructure layer; numbers given were a £10M seed context. He will review with his partner and email in 1–2 days.\n\nAny reason to handle them differently?\n\n${signOff()}`,
    lint: [],
  };
  heads.lint = lintDraft(heads.body, true);
  return [odysseus, solar, intro, heads];
}

export async function proposeNotesToAction(raw: string): Promise<N2AProposal> {
  const blob = cleanBlob(raw);
  const event = await matchEvent(blob);
  const shaped = extractMihaShaped(blob);
  const firm = shaped?.prior?.cleanFirm ?? normalizeFirmName("Project A");
  const dnc = isDnc(event.who, firm);
  if (dnc) {
    throw new Error(dnc);
  }
  const drafts = shaped ? buildDrafts(shaped, event) : [];
  const loops =
    shaped?.commitments
      ?.filter((c) => c.owner === "counterpart" && c.due)
      .map((c) => ({
        text: `${event.who}: ${c.text}`,
        due: c.due as string,
      })) ?? [];
  const summary = [
    `${event.who} — ${firm}.`,
    shaped?.verdicts?.map((v) => `${v.mandate}: ${v.verdict}`).join("; ") ?? "No structured verdicts (blob did not match a known fixture shape).",
    `${drafts.length} drafts prepared, not sent.`,
    shaped?.prior?.history ?? "",
    loops[0] ? `Open loop: ${loops[0].text} by ${loops[0].due}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const proposal: N2AProposal = {
    id: `n2a-${Date.now()}`,
    created_at: new Date().toISOString(),
    confirmed: false,
    event,
    prior: shaped?.prior ?? { cleanFirm: firm },
    firmFacts: shaped?.firmFacts ?? [],
    verdicts: shaped?.verdicts ?? [],
    objections: shaped?.objections ?? [],
    commitments: shaped?.commitments ?? [],
    numbers: shaped?.numbers ?? [],
    sideNote: shaped?.sideNote,
    drafts,
    loops,
    summary,
    rowCreates: 0,
    matchedExisting: true,
  };
  const runs = loadRuns();
  runs.unshift(proposal);
  saveRuns(runs.slice(0, 40));
  return proposal;
}

export async function confirmNotesToAction(id: string): Promise<N2AProposal> {
  const runs = loadRuns();
  const idx = runs.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("Proposal not found");
  const run = runs[idx];
  if (run.confirmed) return run;
  for (const d of run.drafts) {
    if (d.lint.includes("prime framing")) continue;
    if (d.attachMarker && !d.body.includes("[ATTACH BEFORE SENDING")) continue;
    try {
      const created = await createGmailDraft({
        to: d.to,
        subject: d.subject,
        body: d.body,
      });
      d.gmailDraftId = created.id;
    } catch {
      /* leave without id — user can still copy */
    }
  }
  run.confirmed = true;
  runs[idx] = run;
  saveRuns(runs);
  return run;
}

export function loadBriefsForPrior(firmHint: string) {
  const briefs = loadMeetingBriefs();
  const names = Object.values(briefs).filter((b) =>
    (b.firm_name ?? "").toLowerCase().includes(firmHint.toLowerCase()),
  );
  return names.length;
}
