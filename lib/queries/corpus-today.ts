import { listCollisions } from "@/lib/capital/collision";
import { MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";
import {
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";

export type CorpusQuietGroup = {
  code: MandateCode;
  label: string;
  count: number;
};

export type CorpusTodayStats = {
  quietCount: number;
  quietByMandate: CorpusQuietGroup[];
  collisionCount: number;
  unverifiedCount: number;
  signOffCount: number;
};

const QUIET_MS = 7 * 86400000;

export async function getCorpusTodayStats(): Promise<CorpusTodayStats> {
  const empty: CorpusTodayStats = {
    quietCount: 0,
    quietByMandate: [],
    collisionCount: 0,
    unverifiedCount: 0,
    signOffCount: 0,
  };
  if (!capitalConfigured()) return empty;

  const engage = createEngageClient();
  const core = createCoreClient();
  const cutoff = new Date(Date.now() - QUIET_MS).toISOString();

  const [{ data: mandates }, { data: parts }, collisions] = await Promise.all([
    engage.from("mandates").select("id, code"),
    engage
      .from("participations")
      .select("id, person_id, mandate_id, stage, first_sent, latest_touch")
      .not("person_id", "is", null)
      .limit(4000),
    listCollisions(),
  ]);

  const codeByMandate = new Map(
    (mandates ?? []).map((m) => [m.id, String(m.code).toUpperCase()]),
  );
  const signOffCount = (parts ?? []).filter((p) => p.stage === "awaiting_signoff").length;

  const quietPeople = new Set<string>();
  const quietBy = new Map<string, number>();
  for (const p of parts ?? []) {
    const touch = p.latest_touch || p.first_sent;
    if (!touch || touch > cutoff) continue;
    if (p.stage === "disqualified" || p.stage === "blocked" || p.stage === "closed_lost") continue;
    quietPeople.add(p.person_id as string);
    const code = codeByMandate.get(p.mandate_id) ?? "";
    quietBy.set(code, (quietBy.get(code) ?? 0) + 1);
  }

  const personIds = [...quietPeople].slice(0, 400);
  const { data: people } = personIds.length
    ? await core.from("people").select("id, dnc").in("id", personIds)
    : { data: [] };
  const dnc = new Set((people ?? []).filter((p) => p.dnc).map((p) => p.id));
  const quietCount = personIds.filter((id) => !dnc.has(id)).length;

  const onBook = [
    ...new Set(
      (parts ?? [])
        .filter((p) =>
          ["approved", "approached", "responded", "meeting", "awaiting_signoff", "research"].includes(
            p.stage ?? "",
          ),
        )
        .map((p) => p.person_id)
        .filter(Boolean),
    ),
  ] as string[];
  const { count: unverifiedCount } = onBook.length
    ? await core
        .from("people")
        .select("id", { count: "exact", head: true })
        .in("id", onBook.slice(0, 400))
        .not("email", "is", null)
        .in("email_state", ["unknown", "inferred", "generic"])
    : { count: 0 };

  const quietByMandate: CorpusQuietGroup[] = [...quietBy.entries()]
    .filter(([code]) => Boolean((MANDATE_LABEL as Record<string, string>)[code]))
    .map(([code, count]) => ({
      code: code as MandateCode,
      label: MANDATE_LABEL[code as MandateCode],
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    quietCount,
    quietByMandate,
    collisionCount: collisions.length,
    unverifiedCount: unverifiedCount ?? 0,
    signOffCount,
  };
}
