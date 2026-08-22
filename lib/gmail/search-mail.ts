import { getGoogleAccessToken, getGoogleAccessTokenAdmin } from "@/lib/gmail/user-token";
import type { MeetingCorrespondence } from "@/lib/queries/meeting-brief";

async function access(): Promise<{ token: string; scope: string } | null> {
  try {
    const t = await getGoogleAccessToken();
    return { token: t.accessToken, scope: t.scope };
  } catch {
    const t = await getGoogleAccessTokenAdmin();
    if (!t) return null;
    return { token: t.accessToken, scope: t.scope };
  }
}

function header(
  headers: { name?: string; value?: string }[] | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

export async function searchGmailForEmails(
  emails: string[],
  limit = 20,
): Promise<{
  mail: MeetingCorrespondence[];
  gmailOk: boolean;
  error?: string;
}> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))].slice(
    0,
    6,
  );
  if (!unique.length) return { mail: [], gmailOk: false, error: "No addresses to search." };

  const tok = await access();
  if (!tok) return { mail: [], gmailOk: false, error: "Gmail is not connected." };
  if (!tok.scope.includes("gmail.readonly") && !tok.scope.includes("gmail")) {
    return { mail: [], gmailOk: false, error: "Gmail read access is missing. Reconnect Google." };
  }

  const clause = unique.map((e) => `from:${e} OR to:${e}`).join(" OR ");
  const q = encodeURIComponent(
    `(${clause}) -from:gemini-notes@google.com -from:calendar-notification@google.com`,
  );
  try {
    const list = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${limit}`,
      { headers: { Authorization: `Bearer ${tok.token}` } },
    );
    if (!list.ok) {
      return { mail: [], gmailOk: true, error: `Gmail search HTTP ${list.status}` };
    }
    const listed = (await list.json()) as { messages?: { id: string; threadId?: string }[] };
    const ids = (listed.messages ?? []).slice(0, limit);
    const mail: MeetingCorrespondence[] = [];
    const fetched = await Promise.all(
      ids.map(async (m) => {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${tok.token}` } },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as {
          id: string;
          threadId?: string;
          snippet?: string;
          internalDate?: string;
          payload?: { headers?: { name?: string; value?: string }[] };
        };
        const headers = body.payload?.headers ?? [];
        const ms = Number.parseInt(body.internalDate ?? "0", 10);
        return {
          id: body.id,
          threadId: body.threadId,
          from: header(headers, "From") || "Unknown",
          to: header(headers, "To") || "",
          subject: header(headers, "Subject") || "",
          date: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "",
          snippet: body.snippet ?? "",
        } satisfies MeetingCorrespondence;
      }),
    );
    for (const row of fetched) {
      if (row) mail.push(row);
    }
    mail.sort((a, b) => Date.parse(b.date || "0") - Date.parse(a.date || "0"));
    return { mail, gmailOk: true };
  } catch (err) {
    return {
      mail: [],
      gmailOk: true,
      error: err instanceof Error ? err.message : "Gmail search failed.",
    };
  }
}
