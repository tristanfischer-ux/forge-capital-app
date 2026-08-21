import { getSyncState } from "@/lib/capital/rpc";
import { capitalConfigured } from "@/lib/supabase/capital";

export type HeartbeatRow = {
  feed: string;
  last_ok_at: string | null;
  last_error: string | null;
  stale: boolean;
};

const STALE_MS = 24 * 60 * 60 * 1000;

export async function getCapitalHeartbeat(): Promise<{
  configured: boolean;
  rows: HeartbeatRow[];
  staleFeeds: string[];
}> {
  if (!capitalConfigured()) {
    return { configured: false, rows: [], staleFeeds: ["shared-book"] };
  }
  const now = Date.now();
  const rows = (await getSyncState()).map((r) => {
    const t = r.last_ok_at ? Date.parse(r.last_ok_at) : NaN;
    const stale = !Number.isFinite(t) || now - t > STALE_MS;
    return { ...r, stale };
  });
  return {
    configured: true,
    rows,
    staleFeeds: rows.filter((r) => r.stale).map((r) => r.feed),
  };
}
