import { mandateGmailQuery, type MandateCode } from "@/lib/capital/mandates";
import { getGoogleAccessToken, getGoogleAccessTokenAdmin } from "@/lib/gmail/user-token";

export type OutboundThread = {
  threadId: string;
  gmailMessageId: string;
  rfcMessageId: string;
  subject: string;
  sentAt: string | null;
  replied: boolean;
  replyKind: "none" | "reply" | "ooo" | "bounce";
};

function header(
  headers: { name?: string; value?: string }[] | undefined,
  name: string,
): string {
  return headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

function asMsgId(id: string): string {
  const t = id.trim();
  if (!t) return "";
  return t.startsWith("<") ? t : `<${t}>`;
}

function isAutoReply(subject: string): boolean {
  return /^(auto[- ]?reply|automatic reply|out of office|abwesen|ooo\b|vacation|undeliverable|delivery status)/i.test(
    subject,
  );
}

async function gmailToken(): Promise<string> {
  try {
    const t = await getGoogleAccessToken();
    return t.accessToken;
  } catch {
    const t = await getGoogleAccessTokenAdmin();
    if (!t) throw new Error("NOT_CONNECTED");
    return t.accessToken;
  }
}

async function gmailGet<T>(access: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail GET ${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

/**
 * Latest sent mail to this person whose subject is this mandate, plus whether
 * they have since replied on that thread. Chases must use this thread.
 */
export async function findMandateOutboundThread(
  email: string,
  mandateCode: MandateCode,
): Promise<OutboundThread | null> {
  const addr = email.trim().toLowerCase();
  if (!addr.includes("@")) return null;
  const access = await gmailToken();
  const q = mandateGmailQuery(mandateCode, addr);
  const listed = await gmailGet<{ messages?: { id: string; threadId?: string }[] }>(
    access,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=5`,
  );
  const first = listed.messages?.[0];
  if (!first?.id) return null;

  const msg = await gmailGet<{
    id: string;
    threadId?: string;
    internalDate?: string;
    payload?: { headers?: { name?: string; value?: string }[] };
  }>(
    access,
    `/gmail/v1/users/me/messages/${encodeURIComponent(first.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
  );
  const headers = msg.payload?.headers ?? [];
  const subject = header(headers, "Subject");
  const rfc = asMsgId(header(headers, "Message-ID"));
  const threadId = msg.threadId || first.threadId || "";
  if (!threadId) return null;

  const thread = await gmailGet<{
    messages?: {
      id: string;
      labelIds?: string[];
      payload?: { headers?: { name?: string; value?: string }[] };
    }[];
  }>(
    access,
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
  );

  let replyKind: OutboundThread["replyKind"] = "none";
  for (const m of thread.messages ?? []) {
    const from = header(m.payload?.headers, "From").toLowerCase();
    if (!from.includes(addr)) continue;
    const sub = header(m.payload?.headers, "Subject");
    if (/mailer-daemon|postmaster|mail delivery subsystem/.test(from) || isAutoReply(sub)) {
      if (replyKind === "none") replyKind = isAutoReply(sub) ? "ooo" : "bounce";
      continue;
    }
    replyKind = "reply";
    break;
  }

  const ms = Number.parseInt(msg.internalDate ?? "", 10);
  return {
    threadId,
    gmailMessageId: msg.id,
    rfcMessageId: rfc,
    subject,
    sentAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    replied: replyKind === "reply",
    replyKind,
  };
}
