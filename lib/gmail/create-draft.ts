import { createServerClient } from "@/lib/supabase/server";
import { refreshAccessToken } from "./oauth";

/**
 * Create a Gmail draft on behalf of the signed-in user using their stored
 * refresh_token. The draft lives in the user's Drafts folder — this app
 * NEVER auto-sends (per V4-FEEDBACK-ROUND-2.md "No auto-send anywhere").
 *
 * Returns the Gmail message/thread IDs so the caller can deep-link to the
 * draft in Gmail's compose window.
 */

export interface CreateDraftInput {
  to: string;
  subject: string;
  body: string;
}

export interface CreateDraftResult {
  id: string;
  threadId: string;
  message: {
    id: string;
    threadId: string;
  };
}

/**
 * Fetch (or refresh) the user's Gmail access_token from gmail_tokens.
 * Throws if the user hasn't completed the Gmail OAuth connect step.
 */
async function getAccessTokenForCurrentUser(): Promise<string> {
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  const { data: row, error } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) throw new Error(`gmail_tokens read failed: ${error.message}`);
  if (!row) throw new Error("NOT_CONNECTED");

  // If we have a non-expired access_token, use it. Otherwise refresh.
  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expires > now + 60_000) {
    return row.access_token;
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
  return refreshed.access_token;
}

/** Base64-URL-encode an RFC 2822 message. */
function encodeRfc2822Message(to: string, subject: string, body: string): string {
  // Subject may contain non-ASCII; MIME-encode if so.
  const subjectHeader = /[^\x20-\x7e]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
    : subject;
  const message = [
    `To: ${to}`,
    `Subject: ${subjectHeader}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createGmailDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  const accessToken = await getAccessTokenForCurrentUser();
  const raw = encodeRfc2822Message(input.to, input.subject, input.body);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    throw new Error(`Gmail draft create failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CreateDraftResult;
}
