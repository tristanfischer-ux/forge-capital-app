import { createServerClient } from "@/lib/supabase/server";
import { refreshAccessToken } from "./oauth";

/**
 * Read a Gmail thread by id — returns every message on the thread with
 * sender/subject/plain-text body parsed. Used by /approval/test-replies
 * to surface inbound replies to the [TEST] batch so Opus can classify
 * and propose a response.
 *
 * Auth reuses the same `gmail_tokens` access-token refresh dance as
 * create-draft.ts — kept here locally to avoid importing private
 * helpers across files.
 */

export interface GmailThreadMessage {
  id: string;
  threadId: string;
  internalDate: number;
  from: string | null;
  to: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  isFromUser: boolean;
}

export interface GmailThreadResult {
  threadId: string;
  messages: GmailThreadMessage[];
  /** The email address of the signed-in user (for `isFromUser` inference). */
  userEmail: string | null;
}

async function getAccessTokenAndEmail(): Promise<{
  accessToken: string;
  userEmail: string | null;
}> {
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  const { data: row, error } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at, email")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error(`gmail_tokens read failed: ${error.message}`);
  if (!row) throw new Error("NOT_CONNECTED");

  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expires > now + 60_000) {
    return {
      accessToken: row.access_token,
      userEmail: (row.email as string | null) ?? null,
    };
  }

  const refreshed = await refreshAccessToken(row.refresh_token);
  const newExpires = new Date(now + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from("gmail_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.user.id);
  return {
    accessToken: refreshed.access_token,
    userEmail: (row.email as string | null) ?? null,
  };
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
}

function extractPlainText(payload: GmailPayloadPart | undefined): string | null {
  if (!payload) return null;
  // Direct text/plain body.
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  // Multipart — look for text/plain first, else text/html fallback.
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Recurse for nested alternatives / mixed.
    for (const part of payload.parts) {
      const sub = extractPlainText(part);
      if (sub) return sub;
    }
  }
  // Last resort — strip tags from text/html.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return null;
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

export async function getGmailThread(threadId: string): Promise<GmailThreadResult> {
  const { accessToken, userEmail } = await getAccessTokenAndEmail();

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail thread read failed ${res.status}: ${text}`);
  }

  interface RawMessage {
    id: string;
    threadId: string;
    internalDate?: string;
    snippet?: string;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
    } & GmailPayloadPart;
  }
  const data = (await res.json()) as { messages?: RawMessage[] };

  const messages: GmailThreadMessage[] = (data.messages ?? []).map((m) => {
    const headers = m.payload?.headers ?? [];
    const hdr = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      null;
    const from = hdr("From");
    const to = hdr("To");
    const subject = hdr("Subject");
    const bodyText = extractPlainText(m.payload);
    const isFromUser = !!(
      userEmail &&
      from &&
      from.toLowerCase().includes(userEmail.toLowerCase())
    );

    return {
      id: m.id,
      threadId: m.threadId,
      internalDate: Number.parseInt(m.internalDate ?? "0", 10),
      from,
      to,
      subject,
      snippet: m.snippet ?? null,
      body: bodyText,
      isFromUser,
    };
  });

  return { threadId, messages, userEmail };
}
