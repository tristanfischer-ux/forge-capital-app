import { getGoogleAccessToken, getGoogleAccessTokenAdmin } from "@/lib/gmail/user-token";
import { commitCallNotes } from "@/lib/capital/notes-book";

export type GeminiNoteFile = {
  id: string;
  name: string;
  modified: string;
};

export function driveScopeOk(scope: string): boolean {
  return scope.includes("drive.readonly") || scope.includes("drive");
}

async function driveList(accessToken: string): Promise<GeminiNoteFile[]> {
  const q = encodeURIComponent(
    "name contains 'Notes by Gemini' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=40&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(`Drive list HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    files?: { id: string; name: string; modifiedTime?: string }[];
  };
  return (body.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    modified: f.modifiedTime ?? "",
  }));
}

async function driveExport(accessToken: string, id: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export HTTP ${res.status}`);
  return await res.text();
}

export async function listGeminiNotes(): Promise<{
  files: GeminiNoteFile[];
  needsDriveScope: boolean;
}> {
  try {
    const { accessToken, scope } = await getGoogleAccessToken();
    if (!driveScopeOk(scope)) return { files: [], needsDriveScope: true };
    const files = await driveList(accessToken);
    return { files, needsDriveScope: false };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_CONNECTED") {
      return { files: [], needsDriveScope: true };
    }
    throw err;
  }
}

export async function ingestGeminiNotes(limit = 8): Promise<{
  ingested: number;
  skipped: number;
  needsDriveScope: boolean;
  error?: string;
}> {
  let token: string;
  let scope: string;
  try {
    const t = await getGoogleAccessToken();
    token = t.accessToken;
    scope = t.scope;
  } catch {
    const t = await getGoogleAccessTokenAdmin();
    if (!t) return { ingested: 0, skipped: 0, needsDriveScope: true };
    token = t.accessToken;
    scope = t.scope;
  }
  if (!driveScopeOk(scope)) {
    return { ingested: 0, skipped: 0, needsDriveScope: true };
  }
  let files: GeminiNoteFile[];
  try {
    files = await driveList(token);
  } catch (err) {
    return {
      ingested: 0,
      skipped: 0,
      needsDriveScope: /403|401|insufficient/i.test(err instanceof Error ? err.message : ""),
      error: err instanceof Error ? err.message : String(err),
    };
  }
  let ingested = 0;
  let skipped = 0;
  for (const file of files.slice(0, limit)) {
    try {
      const text = await driveExport(token, file.id);
      if (text.trim().length < 40) {
        skipped++;
        continue;
      }
      const result = await commitCallNotes({
        blob: text,
        title: file.name,
        sourceId: `gemini:${file.id}`,
        occurredAt: file.modified || undefined,
      });
      if (result.activityId) ingested++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { ingested, skipped, needsDriveScope: false };
}
