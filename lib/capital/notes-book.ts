import { MANDATE_LABEL, mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { capitalActor, createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { searchBook } from "@/lib/capital/search-book";
import { composeCallFollowUpDraft, composeThankYouDraft } from "@/lib/capital/voice";
import { callOpenRouter } from "@/lib/openrouter";

export type CallInsight = {
  summary: string;
  personName: string | null;
  firmName: string | null;
  emails: string[];
  mandateCodes: MandateCode[];
  firmFacts: string[];
  investorFacts: string[];
  pitchNotes: Partial<Record<MandateCode, string>>;
  nextSteps: string[];
};

const CODE_BY_LABEL: Record<string, MandateCode> = Object.fromEntries(
  (Object.entries(MANDATE_LABEL) as [MandateCode, string][]).map(([c, l]) => [
    l.toLowerCase(),
    c,
  ]),
) as Record<string, MandateCode>;

function detectMandates(blob: string): MandateCode[] {
  const lower = blob.toLowerCase();
  const hits = new Set<MandateCode>();
  for (const [label, code] of Object.entries(CODE_BY_LABEL)) {
    if (lower.includes(label)) hits.add(code);
  }
  if (/\bspace solar\b/i.test(blob)) hits.add("SS");
  if (/\bodysseus\b/i.test(blob)) hits.add("OD");
  if (/\bskysails\b/i.test(blob)) hits.add("SK");
  if (/\bfishfrom\b|\bfischer farms\b/i.test(blob)) hits.add("FF");
  if (/\bpanatere\b/i.test(blob)) hits.add("PA");
  if (/\bcasper\b/i.test(blob)) hits.add("CA");
  if (/\barbitrage\b|\bnasdaq\b/i.test(blob)) hits.add("US");
  if (/\bhooley\b/i.test(blob)) hits.add("HO");
  if (/\byuri\b|\byurigravity\b|\brandom positioning machine\b|\brpm\b/i.test(blob)) {
    hits.add("YU");
  }
  return [...hits];
}

function counterpartFromTitle(title: string): string | null {
  const m = title.match(/^(.+?)\s+and\s+Tristan/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() || null;
}

export async function extractCallInsights(
  blob: string,
  title?: string | null,
): Promise<CallInsight> {
  const emails =
    blob.toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) ?? [];
  const mandateCodes = detectMandates(`${title ?? ""}\n${blob}`);
  const personName = counterpartFromTitle(title ?? "") ?? null;
  let parsed: Partial<CallInsight> = {};
  try {
    const raw = await callOpenRouter({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 8000,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract call notes as JSON. British spelling. Keys: summary (5-8 lines), personName, firmName, firmFacts (string[] about the organisation), investorFacts (string[] about the person), pitchNotes (object mandate code SS|OD|SK|FF|PA|CA|US|HO|YU -> for YU: RPM product/customer learnings, not a raise pitch; for others: what to change in that company's pitch), nextSteps (string[]). Never invent emails. Empty arrays if unknown.",
        },
        { role: "user", content: `${title ?? ""}\n\n${blob.slice(0, 12000)}` },
      ],
    });
    parsed = JSON.parse(raw) as Partial<CallInsight>;
  } catch {
    parsed = {
      summary: blob.slice(0, 600),
      firmFacts: [],
      investorFacts: [],
      nextSteps: [],
    };
  }
  return {
    summary: (parsed.summary ?? blob.slice(0, 600)).trim(),
    personName: parsed.personName ?? personName,
    firmName: parsed.firmName ?? null,
    emails: [...new Set(emails)],
    mandateCodes:
      parsed.mandateCodes && parsed.mandateCodes.length
        ? parsed.mandateCodes
        : mandateCodes,
    firmFacts: parsed.firmFacts ?? [],
    investorFacts: parsed.investorFacts ?? [],
    pitchNotes: parsed.pitchNotes ?? {},
    nextSteps: parsed.nextSteps ?? [],
  };
}

function appendNote(existing: string | null, block: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const chunk = `\n\n[${stamp}]\n${block}`.trim();
  const prev = (existing ?? "").trim();
  const next = prev ? `${prev}${chunk}` : chunk;
  return next.slice(-8000);
}

export type NotesCommitResult = {
  activityId: string | null;
  personId: string | null;
  firmId: string | null;
  drafts: {
    kind: "thank-you" | "follow-up";
    mandate?: MandateCode;
    to: string;
    subject: string;
    body: string;
    cc?: string[];
  }[];
};

export async function commitCallNotes(opts: {
  blob: string;
  title?: string | null;
  sourceId: string;
  occurredAt?: string;
  insights?: CallInsight;
}): Promise<NotesCommitResult> {
  const insights = opts.insights ?? (await extractCallInsights(opts.blob, opts.title));
  const core = createCoreClient();
  const engage = createEngageClient();

  let personId: string | null = null;
  let firmId: string | null = null;
  for (const email of insights.emails) {
    const { data } = await core
      .from("people")
      .select("id, firm_id")
      .ilike("email", email)
      .maybeSingle();
    if (data?.id) {
      personId = data.id;
      firmId = data.firm_id;
      break;
    }
  }
  if (!personId && insights.personName) {
    const hits = await searchBook(insights.personName);
    const person = hits.find((h) => h.kind === "person");
    if (person) {
      personId = person.id;
      firmId = person.firm_id ?? null;
    }
  }
  if (!firmId && insights.firmName) {
    const hits = await searchBook(insights.firmName);
    const firm = hits.find((h) => h.kind === "firm");
    if (firm) firmId = firm.id;
  }

  const { data: existing } = await engage
    .from("activities")
    .select("id")
    .eq("source_id", opts.sourceId)
    .maybeSingle();
  let activityId = existing?.id ?? null;
  if (!activityId) {
    const { data: activity } = await engage
      .from("activities")
      .insert({
        occurred_at: opts.occurredAt ?? new Date().toISOString(),
        channel: "note",
        subject: (opts.title ?? "Call notes").slice(0, 500),
        snippet: insights.summary.slice(0, 500),
        source_id: opts.sourceId,
        match_confidence: personId || firmId ? 0.8 : 0.3,
        created_by: capitalActor(),
      })
      .select("id")
      .maybeSingle();
    activityId = activity?.id ?? null;
    if (activityId) {
      const links = [];
      if (personId)
        links.push({
          activity_id: activityId,
          entity_type: "person",
          entity_id: personId,
          link_source: "app",
        });
      if (firmId)
        links.push({
          activity_id: activityId,
          entity_type: "firm",
          entity_id: firmId,
          link_source: "app",
        });
      if (links.length) await engage.from("activity_links").insert(links);
    }
  }

  if (firmId && (insights.firmFacts.length || insights.summary)) {
    const { data: firm } = await core.from("firms").select("notes").eq("id", firmId).maybeSingle();
    await core
      .from("firms")
      .update({
        notes: appendNote(
          firm?.notes ?? null,
          [`Call: ${insights.summary}`, ...insights.firmFacts.map((f) => `• ${f}`)].join("\n"),
        ),
      })
      .eq("id", firmId);
  }
  if (personId && (insights.investorFacts.length || insights.summary)) {
    const { data: person } = await core
      .from("people")
      .select("notes")
      .eq("id", personId)
      .maybeSingle();
    await core
      .from("people")
      .update({
        notes: appendNote(
          person?.notes ?? null,
          [`Call: ${insights.summary}`, ...insights.investorFacts.map((f) => `• ${f}`)].join("\n"),
        ),
      })
      .eq("id", personId);
  }
  for (const [code, note] of Object.entries(insights.pitchNotes)) {
    if (!note?.trim()) continue;
    const { data: mandate } = await engage
      .from("mandates")
      .select("id, narrative_notes")
      .eq("code", code)
      .maybeSingle();
    if (!mandate) continue;
    await engage
      .from("mandates")
      .update({
        narrative_notes: appendNote(mandate.narrative_notes, `Pitch learning: ${note.trim()}`),
      })
      .eq("id", mandate.id);
  }

  const { data: person } = personId
    ? await core.from("people").select("full_name, email").eq("id", personId).maybeSingle()
    : { data: null };
  const { data: firm } = firmId
    ? await core.from("firms").select("canonical_name").eq("id", firmId).maybeSingle()
    : { data: null };
  const drafts: NotesCommitResult["drafts"] = [];
  if (person?.email) {
    const thank = composeThankYouDraft({
      personName: person.full_name ?? insights.personName ?? "",
      firmName: firm?.canonical_name ?? insights.firmName ?? "",
      mandateCodes: insights.mandateCodes,
      callSummary: insights.summary,
    });
    drafts.push({
      kind: "thank-you",
      to: person.email,
      ...thank,
      cc: insights.mandateCodes.includes("YU") ? mandateDraftCc("YU") : undefined,
    });
    for (const code of insights.mandateCodes) {
      const follow = composeCallFollowUpDraft({
        personName: person.full_name ?? insights.personName ?? "",
        firmName: firm?.canonical_name ?? insights.firmName ?? "",
        mandateCode: code,
        nextStep: insights.nextSteps[0] ?? insights.pitchNotes[code] ?? null,
      });
      drafts.push({
        kind: "follow-up",
        mandate: code,
        to: person.email,
        ...follow,
        cc: mandateDraftCc(code),
      });
    }
  }
  return { activityId, personId, firmId, drafts };
}
