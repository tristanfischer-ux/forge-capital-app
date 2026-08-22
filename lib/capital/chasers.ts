import type { MandateCode } from "@/lib/capital/mandates";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

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
  const [{ data: people }, { data: firms }] = await Promise.all([
    core.from("people").select("id, full_name, email, email_state, dnc").in("id", personIds),
    firmIds.length
      ? core.from("firms").select("id, canonical_name, dnc").in("id", firmIds)
      : Promise.resolve({ data: [] }),
  ]);
  const personBy = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  const firmBy = Object.fromEntries((firms ?? []).map((f) => [f.id, f]));

  const { data: links } = await engage
    .from("activity_links")
    .select("activity_id, entity_id")
    .eq("entity_type", "person")
    .in("entity_id", personIds);
  const actIds = [...new Set((links ?? []).map((l) => l.activity_id))];
  const { data: acts } = actIds.length
    ? await engage
        .from("activities")
        .select("id, occurred_at, channel, subject")
        .in("id", actIds)
        .in("channel", ["email_out", "email_in", "draft"])
        .order("occurred_at", { ascending: false })
        .limit(800)
    : { data: [] };
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
    const history = actsByPerson.get(p.person_id as string) ?? [];
    const lastOut =
      history.find((h) => h.channel === "email_out" || h.channel === "draft") ?? null;
    const lastIn = history.find((h) => h.channel === "email_in") ?? null;
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
    });
  }
  rows.sort((a, b) => b.quietDays - a.quietDays);
  return rows;
}
