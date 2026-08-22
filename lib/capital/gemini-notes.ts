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

async function gmailListNotes(accessToken: string): Promise<GeminiNoteFile[]> {
  const q = encodeURIComponent("from:gemini-notes@google.com");
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error(`Gmail list HTTP ${res.status}`);
    const body = (await res.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of body.messages ?? []) ids.push(m.id);
    pageToken = body.nextPageToken;
  } while (pageToken && ids.length < 80);

  const files: GeminiNoteFile[] = [];
  for (const id of ids.slice(0, 40)) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) continue;
    const msg = (await res.json()) as {
      payload?: { headers?: { name?: string; value?: string }[] };
      internalDate?: string;
    };
    const headers = msg.payload?.headers ?? [];
    const subject =
      headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "Gemini notes";
    const date =
      headers.find((h) => h.name?.toLowerCase() === "date")?.value ??
      (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "");
    files.push({ id: `gmail:${id}`, name: subject, modified: date });
  }
  return files;
}

export async function listGeminiNotes(): Promise<{
  files: GeminiNoteFile[];
  needsDriveScope: boolean;
}> {
  try {
    const { accessToken, scope } = await getGoogleAccessToken();
    if (scope.includes("gmail.readonly") || scope.includes("gmail")) {
      const files = await gmailListNotes(accessToken);
      return { files, needsDriveScope: !driveScopeOk(scope) };
    }
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
  let ingested = 0;
  let skipped = 0;

  const canGmail = scope.includes("gmail.readonly") || scope.includes("gmail");
  if (canGmail) {
    try {
      const q = encodeURIComponent("from:gemini-notes@google.com");
      const list = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${limit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!list.ok) throw new Error(`Gmail list HTTP ${list.status}`);
      const listed = (await list.json()) as { messages?: { id: string }[] };
      for (const m of listed.messages ?? []) {
        const full = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!full.ok) {
          skipped++;
          continue;
        }
        const msg = (await full.json()) as {
          payload?: {
            headers?: { name?: string; value?: string }[];
            body?: { data?: string };
            parts?: { mimeType?: string; body?: { data?: string } }[];
          };
          internalDate?: string;
        };
        const headers = msg.payload?.headers ?? [];
        const subject =
          headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "Gemini notes";
        const html =
          decodePart(msg.payload?.body?.data) ||
          decodePart(
            msg.payload?.parts?.find((p) => p.mimeType === "text/html")?.body?.data,
          ) ||
          decodePart(
            msg.payload?.parts?.find((p) => p.mimeType === "text/plain")?.body?.data,
          );
        const docId = html.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)?.[1];
        let blob = stripTags(html);
        if (docId && driveScopeOk(scope)) {
          try {
            const extra = await driveExport(token, docId);
            if (extra.length > blob.length) blob = extra;
          } catch {
            /* keep the Gmail summary */
          }
        }
        if (blob.trim().length < 40) {
          skipped++;
          continue;
        }
        const occurred = msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : undefined;
        const result = await commitCallNotes({
          blob,
          title: subject,
          sourceId: `gmail-gemini:${m.id}`,
          occurredAt: occurred,
        });
        if (result.activityId) ingested++;
        else skipped++;
      }
      return { ingested, skipped, needsDriveScope: !driveScopeOk(scope) };
    } catch (err) {
      return {
        ingested,
        skipped,
        needsDriveScope: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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

function decodePart(data?: string): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
