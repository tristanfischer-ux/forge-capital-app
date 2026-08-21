import { COLLISION_DAYS } from "@/lib/capital/mandates";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

export type CollisionRow = {
  person_id: string | null;
  firm_id: string | null;
  person_name: string | null;
  firm_name: string | null;
  mandate_a: string;
  mandate_b: string;
  date_a: string;
  date_b: string;
  days_apart: number;
};

function touchDate(p: { first_sent?: string | null; latest_touch?: string | null; updated_at?: string | null }): string | null {
  return p.latest_touch || p.first_sent || null;
}

export async function listCollisions(withinDays = COLLISION_DAYS): Promise<CollisionRow[]> {
  const engage = createEngageClient();
  const core = createCoreClient();
  const since = new Date(Date.now() - withinDays * 86400000).toISOString();
  const { data: parts, error } = await engage
    .from("participations")
    .select("id, person_id, firm_id, mandate_id, first_sent, latest_touch, stage, mandates:mandate_id ( code )")
    .or(`latest_touch.gte.${since},first_sent.gte.${since}`)
    .not("stage", "in", "(disqualified,blocked,closed_lost,research)");
  if (error || !parts?.length) return [];

  type Part = {
    person_id: string | null;
    firm_id: string | null;
    first_sent: string | null;
    latest_touch: string | null;
    mandates: { code?: string } | { code?: string }[] | null;
  };

  const byKey = new Map<string, Part[]>();
  for (const raw of parts) {
    const p = raw as Part;
    const key = p.person_id ? `p:${p.person_id}` : p.firm_id ? `f:${p.firm_id}` : null;
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(p);
    byKey.set(key, list);
  }

  const personIds = [...new Set(parts.map((p) => p.person_id).filter(Boolean))] as string[];
  const firmIds = [...new Set(parts.map((p) => p.firm_id).filter(Boolean))] as string[];
  const [{ data: people }, { data: firms }] = await Promise.all([
    personIds.length
      ? core.from("people").select("id, full_name").in("id", personIds)
      : Promise.resolve({ data: [] }),
    firmIds.length
      ? core.from("firms").select("id, canonical_name").in("id", firmIds)
      : Promise.resolve({ data: [] }),
  ]);
  const personName = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name]));
  const firmName = Object.fromEntries((firms ?? []).map((f) => [f.id, f.canonical_name]));

  const rows: CollisionRow[] = [];
  for (const [key, list] of byKey) {
    const codes = list
      .map((p) => {
        const m = Array.isArray(p.mandates) ? p.mandates[0] : p.mandates;
        return { code: m?.code ?? "?", date: touchDate(p) };
      })
      .filter((x) => x.date);
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        if (codes[i].code === codes[j].code) continue;
        const da = new Date(codes[i].date as string).getTime();
        const db = new Date(codes[j].date as string).getTime();
        const days = Math.abs(da - db) / 86400000;
        if (days > withinDays) continue;
        const personId = key.startsWith("p:") ? key.slice(2) : list[0].person_id;
        const firmId = list[0].firm_id;
        rows.push({
          person_id: personId,
          firm_id: firmId,
          person_name: personId ? personName[personId] ?? null : null,
          firm_name: firmId ? firmName[firmId] ?? null : null,
          mandate_a: codes[i].code as string,
          mandate_b: codes[j].code as string,
          date_a: (codes[i].date as string).slice(0, 10),
          date_b: (codes[j].date as string).slice(0, 10),
          days_apart: Math.round(days),
        });
      }
    }
  }
  rows.sort((a, b) => a.days_apart - b.days_apart);
  return rows;
}

export async function collisionsFor(
  firmId: string | null,
  personId: string | null,
  mandateCode: string,
): Promise<CollisionRow[]> {
  const all = await listCollisions();
  return all.filter((r) => {
    if (r.mandate_a !== mandateCode && r.mandate_b !== mandateCode) return false;
    if (personId && r.person_id === personId) return true;
    if (firmId && r.firm_id === firmId) return true;
    return false;
  });
}
