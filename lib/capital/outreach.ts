import { listCollisions } from "@/lib/capital/collision";
import { listNeverWrittenOn, type ChaserRow } from "@/lib/capital/chasers";
import { evaluateDraftGate } from "@/lib/capital/draft-gate";
import {
  MANDATE_LABEL,
  isCustomerMandate,
  type MandateCode,
} from "@/lib/capital/mandates";
import { thesisFromBook } from "@/lib/capital/thesis-from-book";
import { composeOutreachDraft } from "@/lib/capital/voice";
import { type OutreachDraftRow } from "@/lib/capital/outreach-types";

export type { OutreachDraftRow } from "@/lib/capital/outreach-types";
export { OUTREACH_RAISES } from "@/lib/capital/outreach-types";
import {
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";
import { inChunks } from "@/lib/supabase/in-chunks";

export function outreachBlocked(code: MandateCode): string | null {
  if (code === "SK") return "SkySails broad outreach is suspended.";
  if (code === "HO") return "Hooley RF is paused until Tony Hooley signs off.";
  if (isCustomerMandate(code)) return "Yuri is customer outreach, not a raise.";
  return null;
}

export type WorkingAnchor = {
  firmId: string;
  firmName: string;
  stage: string;
  sectors: string | null;
};

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
}

export async function workingSet(code: MandateCode): Promise<{
  anchors: WorkingAnchor[];
  tokens: string[];
  note: string;
}> {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate, error } = await engage
    .from("mandates")
    .select("id, ask_summary, narrative_notes, status, company_name")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    return { anchors: [], tokens: [], note: `Book query failed: ${error.message}` };
  }
  if (!mandate) {
    return {
      anchors: [],
      tokens: [],
      note: `No mandate row for ${MANDATE_LABEL[code]} (${code}) on the shared book.`,
    };
  }
  const { data: parts } = await engage
    .from("participations")
    .select("firm_id, stage")
    .eq("mandate_id", mandate.id)
    .in("stage", ["committed", "meeting", "responded", "dataroom", "approved", "approached"])
    .not("firm_id", "is", null)
    .limit(200);
  const firmIds = [...new Set((parts ?? []).map((p) => p.firm_id).filter(Boolean))] as string[];
  const firms = firmIds.length
    ? await inChunks(firmIds, async (chunk) => {
        const { data } = await core
          .from("firms")
          .select("id, canonical_name, sectors, notes, dnc")
          .in("id", chunk);
        return data ?? [];
      })
    : [];
  const stageBy = Object.fromEntries((parts ?? []).map((p) => [p.firm_id as string, p.stage]));
  const anchors: WorkingAnchor[] = [];
  const tokens = new Set<string>();
  for (const f of firms) {
    if (f.dnc) continue;
    const sectors = Array.isArray(f.sectors) ? f.sectors.filter(Boolean).join(", ") : null;
    anchors.push({
      firmId: f.id,
      firmName: f.canonical_name ?? "—",
      stage: stageBy[f.id] ?? "",
      sectors,
    });
    for (const t of tokenise(`${sectors ?? ""} ${f.notes ?? ""} ${f.canonical_name ?? ""}`)) {
      tokens.add(t);
    }
  }
  for (const t of tokenise(`${mandate.ask_summary ?? ""} ${mandate.narrative_notes ?? ""} ${mandate.company_name ?? ""} ${MANDATE_LABEL[code]}`)) {
    tokens.add(t);
  }
  const note =
    anchors.length === 0
      ? `No replied or approved firms to seed from yet. Using the ${MANDATE_LABEL[code]} mandate text to hunt lookalikes.`
      : `${anchors.length} firms on ${MANDATE_LABEL[code]} at approved / approached / replied / met. That is the seed.`;
  return { anchors, tokens: [...tokens].slice(0, 32), note };
}

export async function shapeSamples(
  code: MandateCode,
  instruction?: string | null,
): Promise<OutreachDraftRow[]> {
  const blocked = outreachBlocked(code);
  if (blocked) return [];
  const never = (await listNeverWrittenOn(code)).filter(
    (r) => r.stage === "approved" && r.emailState === "verified" && !r.paused,
  );
  const pick = never.slice(0, 3);
  if (pick.length > 0) {
    return composeRows(code, pick, true, "Already approved, never written.", instruction);
  }
  const fallback = (await listNeverWrittenOn(code)).filter((r) => r.emailState === "verified" && !r.paused).slice(0, 3);
  return composeRows(code, fallback, true, "Verified people on this raise, used as a shape sample.", instruction);
}

async function composeRows(
  code: MandateCode,
  rows: Pick<
    ChaserRow,
    | "personId"
    | "firmId"
    | "participationId"
    | "personName"
    | "firmName"
    | "email"
    | "emailState"
    | "stage"
  >[],
  sample: boolean,
  why: string,
  instruction?: string | null,
): Promise<OutreachDraftRow[]> {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage
    .from("mandates")
    .select("ask_summary, narrative_notes, status")
    .eq("code", code)
    .maybeSingle();
  const collisions = await listCollisions();
  const colliding = new Set(collisions.map((c) => c.person_id).filter(Boolean) as string[]);
  const firmIds = [...new Set(rows.map((r) => r.firmId).filter(Boolean))] as string[];
  const firms = firmIds.length
    ? await inChunks(firmIds, async (chunk) => {
        const { data } = await core.from("firms").select("id, sectors, notes, hq_country").in("id", chunk);
        return data ?? [];
      })
    : [];
  const firmExtra = Object.fromEntries(firms.map((f) => [f.id, f]));
  const out: OutreachDraftRow[] = [];
  for (const r of rows) {
    const extra = r.firmId ? firmExtra[r.firmId] : null;
    const sectors = Array.isArray(extra?.sectors) ? extra.sectors.filter(Boolean).join(", ") : null;
    const mapped = thesisFromBook({
      firmName: r.firmName,
      sectors,
      notes: extra?.notes ?? null,
      instruction,
    });
    const gate = await evaluateDraftGate({
      personId: r.personId,
      firmId: r.firmId,
      mandateCode: code,
      stage: r.stage,
    });
    const collision = colliding.has(r.personId);
    const needsResearch = !mapped.thesisLine;
    let subject: string | null = null;
    let body: string | null = null;
    let gateWhy = gate.allowed ? null : gate.why;
    if (needsResearch) gateWhy = gateWhy ?? "No checkable thesis fact on the book — will not invent Block 3.";
    if (collision) gateWhy = gateWhy ?? "Approached on another programme in 21 days.";
    if (gate.allowed && mapped.thesisLine && !collision) {
      const composed = composeOutreachDraft({
        personName: r.personName,
        firmName: r.firmName,
        mandateCode: code,
        askSummary: mandate?.ask_summary,
        narrativeNotes: mandate?.narrative_notes,
        thesisLine: mapped.thesisLine,
        subjectHook: mapped.subjectHook,
        instruction,
        warm: gate.warm,
        lastSubject: gate.lastThread?.subject,
        lastOccurredAt: gate.lastThread?.occurred_at,
      });
      const linted = await evaluateDraftGate({
        personId: r.personId,
        firmId: r.firmId,
        mandateCode: code,
        stage: r.stage,
        body: composed.body,
        subject: composed.subject,
        opener: composed.body,
      });
      if (!linted.allowed) {
        gateWhy = linted.why;
      } else {
        subject = composed.subject;
        body = composed.body;
      }
    }
    out.push({
      personId: r.personId,
      firmId: r.firmId,
      participationId: r.participationId,
      personName: r.personName,
      firmName: r.firmName,
      email: r.email,
      emailState: r.emailState,
      stage: r.stage,
      sample,
      why,
      thesisLine: mapped.thesisLine,
      thesisSource: mapped.source,
      subject,
      body,
      needsResearch,
      gateWhy,
      collision,
    });
  }
  return out;
}

export async function lookalikeCandidates(
  code: MandateCode,
  n: number,
  instruction?: string | null,
): Promise<OutreachDraftRow[]> {
  const blocked = outreachBlocked(code);
  if (blocked) return [];
  const { anchors, tokens } = await workingSet(code);
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage.from("mandates").select("id").eq("code", code).maybeSingle();
  if (!mandate) return [];
  const { data: existing } = await engage
    .from("participations")
    .select("firm_id, person_id, id, stage")
    .eq("mandate_id", mandate.id)
    .limit(2000);
  const alreadyOn = new Set(
    (existing ?? []).map((p) => p.firm_id).filter(Boolean) as string[],
  );

  const { data: firms } = await core
    .from("firms")
    .select("id, canonical_name, website_domain, sectors, notes, dnc")
    .eq("dnc", false)
    .limit(800);
  const seed = new Set(anchors.map((a) => a.firmId));
  const scored: { id: string; name: string; score: number; sectors: string | null; notes: string | null }[] = [];
  for (const f of firms ?? []) {
    if (seed.has(f.id) || alreadyOn.has(f.id)) continue;
    const hay = `${Array.isArray(f.sectors) ? f.sectors.join(" ") : ""} ${f.notes ?? ""} ${f.canonical_name ?? ""}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    if (score < 1) continue;
    scored.push({
      id: f.id,
      name: f.canonical_name ?? "—",
      score,
      sectors: Array.isArray(f.sectors) ? f.sectors.join(", ") : null,
      notes: f.notes,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const pickFirms = scored.slice(0, Math.min(50, Math.max(n, 5)));

  const firmIds = pickFirms.map((f) => f.id);
  const people = firmIds.length
    ? await inChunks(firmIds, async (chunk) => {
        const { data } = await core
          .from("people")
          .select("id, firm_id, full_name, email, email_state, dnc, role_title")
          .in("firm_id", chunk)
          .eq("dnc", false)
          .limit(200);
        return data ?? [];
      })
    : [];
  const peopleByFirm = new Map<string, typeof people>();
  for (const p of people) {
    if (!p.firm_id) continue;
    const arr = peopleByFirm.get(p.firm_id) ?? [];
    arr.push(p);
    peopleByFirm.set(p.firm_id, arr);
  }

  const partByFirm = new Map<string, { id: string; person_id: string | null; stage: string | null }>();
  for (const p of existing ?? []) {
    if (p.firm_id && !partByFirm.has(p.firm_id)) partByFirm.set(p.firm_id, p);
  }

  const asRows: Parameters<typeof composeRows>[1] = [];
  const whyByPerson = new Map<string, string>();
  for (const f of pickFirms) {
    const team = peopleByFirm.get(f.id) ?? [];
    const person =
      team.find((p) => p.email_state === "verified" && p.email) ??
      team.find((p) => p.email) ??
      team[0];
    if (!person) continue;
    const part = partByFirm.get(f.id);
    asRows.push({
      personId: person.id,
      firmId: f.id,
      participationId: part?.id ?? `pending:${f.id}`,
      personName: person.full_name ?? "—",
      firmName: f.name,
      email: person.email,
      emailState: person.email_state,
      stage: part?.stage ?? "research",
    });
    const overlap = tokens.filter((t) => `${f.sectors ?? ""} ${f.notes ?? ""}`.toLowerCase().includes(t)).slice(0, 4);
    whyByPerson.set(
      person.id,
      `Looks like ${anchors
        .slice(0, 3)
        .map((a) => a.firmName)
        .join(", ")}${overlap.length ? ` · ${overlap.join(", ")}` : ""}`,
    );
    if (asRows.length >= n) break;
  }
  const composed = await composeRows(code, asRows, false, "Lookalike from what has worked.", instruction);
  return composed.map((row) => ({ ...row, why: whyByPerson.get(row.personId) ?? row.why }));
}

export async function mandateCopy(code: MandateCode): Promise<{
  askSummary: string | null;
  narrativeNotes: string | null;
  status: string | null;
  companyName: string | null;
}> {
  const engage = createEngageClient();
  const { data } = await engage
    .from("mandates")
    .select("ask_summary, narrative_notes, status, company_name")
    .eq("code", code)
    .maybeSingle();
  return {
    askSummary: data?.ask_summary ?? null,
    narrativeNotes: data?.narrative_notes ?? null,
    status: data?.status ?? null,
    companyName: data?.company_name ?? null,
  };
}
