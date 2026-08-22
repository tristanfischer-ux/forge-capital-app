import { MANDATE_CODES, MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { inChunks } from "@/lib/supabase/in-chunks";

function isAutoReply(subject: string | null): boolean {
  return /^(auto[- ]?reply|automatic reply|out of office|abwesen|ooo\b|vacation|undeliverable|delivery status)/i.test(
    subject ?? "",
  );
}

export type ChaserRow = {
  participationId: string;
  personId: string;
  firmId: string | null;
  personName: string;
  firmName: string;
  email: string | null;
  emailState: string | null;
  stage: string;
  lastOutboundAt: string | null;
  lastOutboundSubject: string | null;
  lastInboundAt: string | null;
  quietDays: number;
  mandateCode: MandateCode;
  kind: "quiet" | "never";
  paused: boolean;
};

export async function listChasers(opts: {
  mandateCode: MandateCode;
  quietDays: number;
}): Promise<ChaserRow[]> {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage
    .from("mandates")
    .select("id")
    .eq("code", opts.mandateCode)
    .maybeSingle();
  if (!mandate) return [];

  const { data: parts } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, first_sent, latest_touch")
    .eq("mandate_id", mandate.id)
    .not("person_id", "is", null)
    .in("stage", ["research", "approved", "approached", "responded", "meeting"])
    .limit(400);
  if (!parts?.length) return [];

  const personIds = [...new Set(parts.map((p) => p.person_id).filter(Boolean))] as string[];
  const firmIds = [...new Set(parts.map((p) => p.firm_id).filter(Boolean))] as string[];
  const [people, firms] = await Promise.all([
    inChunks(personIds, async (chunk) => {
      const { data, error } = await core
        .from("people")
        .select("id, full_name, email, email_state, dnc")
        .in("id", chunk);
      if (error) console.error("chasers people", error.message);
      return data ?? [];
    }),
    firmIds.length
      ? inChunks(firmIds, async (chunk) => {
          const { data, error } = await core
            .from("firms")
            .select("id, canonical_name, dnc")
            .in("id", chunk);
          if (error) console.error("chasers firms", error.message);
          return data ?? [];
        })
      : Promise.resolve([]),
  ]);
  const personBy = Object.fromEntries(people.map((p) => [p.id, p]));
  const firmBy = Object.fromEntries(firms.map((f) => [f.id, f]));

  const links = await inChunks(personIds, async (chunk) => {
    const { data, error } = await engage
      .from("activity_links")
      .select("activity_id, entity_id")
      .eq("entity_type", "person")
      .in("entity_id", chunk);
    if (error) console.error("chasers links", error.message);
    return data ?? [];
  });
  const actIds = [...new Set(links.map((l) => l.activity_id))];
  const acts = actIds.length
    ? await inChunks(actIds, async (chunk) => {
        const { data, error } = await engage
          .from("activities")
          .select("id, occurred_at, channel, subject")
          .in("id", chunk)
          .in("channel", ["email_out", "email_in", "draft"]);
        if (error) console.error("chasers acts", error.message);
        return data ?? [];
      })
    : [];
  const actsByPerson = new Map<string, { occurred_at: string; channel: string; subject: string | null }[]>();
  const peopleByAct = new Map<string, string[]>();
  for (const l of links ?? []) {
    const arr = peopleByAct.get(l.activity_id) ?? [];
    arr.push(l.entity_id);
    peopleByAct.set(l.activity_id, arr);
  }
  for (const a of acts ?? []) {
    for (const pid of peopleByAct.get(a.id) ?? []) {
      const list = actsByPerson.get(pid) ?? [];
      list.push({ occurred_at: a.occurred_at, channel: a.channel, subject: a.subject });
      actsByPerson.set(pid, list);
    }
  }

  const now = Date.now();
  const rows: ChaserRow[] = [];
  for (const p of parts) {
    const person = p.person_id ? personBy[p.person_id] : null;
    if (!person || person.dnc) continue;
    const firm = p.firm_id ? firmBy[p.firm_id] : null;
    if (firm?.dnc) continue;
    const history = (actsByPerson.get(p.person_id as string) ?? [])
      .slice()
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const lastOut =
      history.find((h) => h.channel === "email_out" || h.channel === "draft") ?? null;
    const lastIn =
      history.find((h) => h.channel === "email_in" && !isAutoReply(h.subject)) ?? null;
    const outAt =
      lastOut?.occurred_at ?? p.latest_touch ?? p.first_sent ?? null;
    if (!outAt) continue;
    const inAt = lastIn?.occurred_at ?? null;
    if (inAt && new Date(inAt).getTime() >= new Date(outAt).getTime()) continue;
    const quietDays = Math.floor((now - new Date(outAt).getTime()) / 86400000);
    if (quietDays < opts.quietDays) continue;
    rows.push({
      participationId: p.id,
      personId: person.id,
      firmId: p.firm_id,
      personName: person.full_name ?? "—",
      firmName: firm?.canonical_name ?? "—",
      email: person.email,
      emailState: person.email_state,
      stage: p.stage,
      lastOutboundAt: outAt,
      lastOutboundSubject: lastOut?.subject ?? null,
      lastInboundAt: inAt,
      quietDays,
      mandateCode: opts.mandateCode,
      kind: "quiet",
      paused: opts.mandateCode === "HO",
    });
  }
  rows.sort((a, b) => b.quietDays - a.quietDays);
  return rows;
}

export async function listQuietPeople(opts: { quietDays: number }): Promise<ChaserRow[]> {
  const nested = await Promise.all(
    MANDATE_CODES.map((code) => listChasers({ mandateCode: code, quietDays: opts.quietDays })),
  );
  return nested.flat().sort((a, b) => b.quietDays - a.quietDays || a.personName.localeCompare(b.personName));
}

export async function listNeverWritten(): Promise<ChaserRow[]> {
  const nested = await Promise.all(MANDATE_CODES.map((code) => listNeverWrittenOn(code)));
  return nested.flat().sort((a, b) => a.personName.localeCompare(b.personName));
}

async function listNeverWrittenOn(mandateCode: MandateCode): Promise<ChaserRow[]> {
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: mandate } = await engage.from("mandates").select("id").eq("code", mandateCode).maybeSingle();
  if (!mandate) return [];

  const { data: parts } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, first_sent, latest_touch")
    .eq("mandate_id", mandate.id)
    .not("person_id", "is", null)
    .in("stage", ["research", "approved"])
    .limit(400);
  if (!parts?.length) return [];

  const personIds = [...new Set(parts.map((p) => p.person_id).filter(Boolean))] as string[];
  const firmIds = [...new Set(parts.map((p) => p.firm_id).filter(Boolean))] as string[];
  const [people, firms] = await Promise.all([
    inChunks(personIds, async (chunk) => {
      const { data } = await core
        .from("people")
        .select("id, full_name, email, email_state, dnc")
        .in("id", chunk);
      return data ?? [];
    }),
    firmIds.length
      ? inChunks(firmIds, async (chunk) => {
          const { data } = await core.from("firms").select("id, canonical_name, dnc").in("id", chunk);
          return data ?? [];
        })
      : Promise.resolve([]),
  ]);
  const personBy = Object.fromEntries(people.map((p) => [p.id, p]));
  const firmBy = Object.fromEntries(firms.map((f) => [f.id, f]));

  const links = await inChunks(personIds, async (chunk) => {
    const { data } = await engage
      .from("activity_links")
      .select("activity_id, entity_id")
      .eq("entity_type", "person")
      .in("entity_id", chunk);
    return data ?? [];
  });
  const actIds = [...new Set(links.map((l) => l.activity_id))];
  const acts = actIds.length
    ? await inChunks(actIds, async (chunk) => {
        const { data } = await engage
          .from("activities")
          .select("id, occurred_at, channel")
          .in("id", chunk)
          .in("channel", ["email_out", "email_in", "draft"]);
        return data ?? [];
      })
    : [];
  const peopleByAct = new Map<string, string[]>();
  for (const l of links) {
    const arr = peopleByAct.get(l.activity_id) ?? [];
    arr.push(l.entity_id);
    peopleByAct.set(l.activity_id, arr);
  }
  const hasOut = new Set<string>();
  for (const a of acts) {
    if (a.channel !== "email_out" && a.channel !== "draft") continue;
    for (const pid of peopleByAct.get(a.id) ?? []) hasOut.add(pid);
  }

  const rows: ChaserRow[] = [];
  for (const p of parts) {
    const person = p.person_id ? personBy[p.person_id] : null;
    if (!person || person.dnc) continue;
    const firm = p.firm_id ? firmBy[p.firm_id] : null;
    if (firm?.dnc) continue;
    if (p.first_sent || p.latest_touch) continue;
    if (hasOut.has(p.person_id as string)) continue;
    rows.push({
      participationId: p.id,
      personId: person.id,
      firmId: p.firm_id,
      personName: person.full_name ?? "—",
      firmName: firm?.canonical_name ?? "—",
      email: person.email,
      emailState: person.email_state,
      stage: p.stage,
      lastOutboundAt: null,
      lastOutboundSubject: null,
      lastInboundAt: null,
      quietDays: 0,
      mandateCode: mandateCode,
      kind: "never",
      paused: mandateCode === "HO",
    });
  }
  return rows;
}

export function mandateCaption(code: MandateCode): string {
  return `${code} · ${MANDATE_LABEL[code]}${code === "YU" ? " · customers" : ""}${code === "HO" ? " · paused" : ""}`;
}
