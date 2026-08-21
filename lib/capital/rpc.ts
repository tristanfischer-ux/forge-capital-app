import {
  capitalActor,
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";

export type FirmMatch = {
  firm_id: string | null;
  canonical_name: string | null;
  match_type: string | null;
  confidence: number | null;
};

function asMatch(data: unknown): FirmMatch | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    firm_id: typeof r.firm_id === "string" ? r.firm_id : null,
    canonical_name: typeof r.canonical_name === "string" ? r.canonical_name : null,
    match_type: typeof r.match_type === "string" ? r.match_type : null,
    confidence: typeof r.confidence === "number" ? r.confidence : null,
  };
}

export async function matchFirm(name: string): Promise<{
  match: FirmMatch | null;
  error: string | null;
}> {
  if (!capitalConfigured()) {
    return { match: null, error: "shared book is not configured" };
  }
  const core = createCoreClient();
  const { data, error } = await core.rpc("match_firm", { name });
  if (error) return { match: null, error: error.message };
  return { match: asMatch(data), error: null };
}

export type LogActivityInput = {
  firm_name: string;
  mandate_code?: string | null;
  occurred_at?: string;
  channel: string;
  subject?: string | null;
  snippet?: string | null;
  source_id?: string | null;
  allow_create_firm?: boolean;
};

export type LogActivityResult = {
  ok: boolean;
  error?: string;
  suggestions?: unknown;
  activity_id?: string;
  raw?: unknown;
};

export async function logActivity(
  input: LogActivityInput,
): Promise<LogActivityResult> {
  if (!capitalConfigured()) {
    return { ok: false, error: "shared book is not configured" };
  }
  const engage = createEngageClient();
  const payload = {
    firm_name: input.firm_name,
    mandate_code: input.mandate_code ?? null,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    channel: input.channel,
    subject: input.subject ?? null,
    snippet: input.snippet ?? null,
    source_id: input.source_id ?? null,
    allow_create_firm: input.allow_create_firm ?? false,
    actor: capitalActor(),
  };
  const { data, error } = await engage.rpc("log_activity", payload);
  if (error) {
    return { ok: false, error: error.message, raw: error };
  }
  if (data && typeof data === "object" && "ok" in (data as object)) {
    return data as LogActivityResult;
  }
  return { ok: true, raw: data };
}

export async function getSyncState(): Promise<
  { feed: string; last_ok_at: string | null; last_error: string | null }[]
> {
  if (!capitalConfigured()) return [];
  const engage = createEngageClient();
  const { data, error } = await engage
    .from("sync_state")
    .select("feed, last_ok_at, last_error");
  if (error || !data) return [];
  return data as {
    feed: string;
    last_ok_at: string | null;
    last_error: string | null;
  }[];
}

export async function bumpSyncState(
  feed: string,
  errorMessage?: string | null,
): Promise<void> {
  if (!capitalConfigured()) return;
  const engage = createEngageClient();
  const patch = errorMessage
    ? { last_error: errorMessage }
    : { last_ok_at: new Date().toISOString(), last_error: null };
  await engage.from("sync_state").update(patch).eq("feed", feed);
}
