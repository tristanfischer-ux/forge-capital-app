import { createCoreClient, createEngageClient, capitalConfigured } from "@/lib/supabase/capital";

export async function getCapitalBookCounts(): Promise<{
  configured: boolean;
  firms: number;
  people: number;
  participations: number;
  pendingReview: number;
}> {
  if (!capitalConfigured()) {
    return { configured: false, firms: 0, people: 0, participations: 0, pendingReview: 0 };
  }
  const core = createCoreClient();
  const engage = createEngageClient();
  const [firms, people, parts, pending] = await Promise.all([
    core.from("firms").select("*", { count: "exact", head: true }),
    core.from("people").select("*", { count: "exact", head: true }),
    engage.from("participations").select("*", { count: "exact", head: true }),
    core.from("import_quarantine").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    configured: true,
    firms: firms.count ?? 0,
    people: people.count ?? 0,
    participations: parts.count ?? 0,
    pendingReview: pending.count ?? 0,
  };
}

export async function listPendingQuarantine(limit = 100) {
  if (!capitalConfigured()) return [];
  const core = createCoreClient();
  const { data, error } = await core
    .from("import_quarantine")
    .select("id, source, status, suggested_match, raw_payload, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}
