import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeskMeeting, DeskReply } from "@/lib/queries/desk-today";

export interface DeskWeekCache {
  generated_at: string | null;
  source: string | null;
  meetings: DeskMeeting[];
  replies: (DeskReply & { preview?: string | null; from?: string | null })[];
}

export async function readDeskWeekCache(): Promise<DeskWeekCache> {
  const file = join(process.cwd(), "data/desk-week.json");
  if (!existsSync(file)) {
    return { generated_at: null, source: null, meetings: [], replies: [] };
  }
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as DeskWeekCache;
    return {
      generated_at: raw.generated_at ?? null,
      source: raw.source ?? null,
      meetings: Array.isArray(raw.meetings) ? raw.meetings : [],
      replies: Array.isArray(raw.replies) ? raw.replies : [],
    };
  } catch {
    return { generated_at: null, source: null, meetings: [], replies: [] };
  }
}

export function mergeMeetings(
  fromDb: DeskMeeting[],
  fromCache: DeskMeeting[],
): DeskMeeting[] {
  if (fromCache.length === 0) return fromDb;
  const seen = new Set(fromCache.map((m) => m.id));
  const extra = fromDb.filter((m) => !seen.has(m.id) && !seen.has(`gcal:${m.id}`));
  return [...fromCache, ...extra].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );
}

export function mergeReplies(
  fromDb: DeskReply[],
  fromCache: DeskReply[],
): DeskReply[] {
  const byId = new Map<string, DeskReply>();
  for (const row of [...fromCache, ...fromDb]) {
    if (row.id) byId.set(row.id, row);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime(),
  );
}
