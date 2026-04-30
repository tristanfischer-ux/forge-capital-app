"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "@/lib/gmail/oauth";

/**
 * Manual "Sync now" trigger — runs the same Gmail inbound sync logic
 * as the /api/cron/gmail-sync cron route, callable from a server
 * action so Tristan can trigger an ad-hoc run from the pipeline page.
 *
 * Scope: syncs all connected users (same as the cron). Limited to
 * 100 messages per batch to keep the request within Vercel's server
 * action timeout. The cron handles large backlogs; this is for
 * "check if it's working right now".
 *
 * Returns a plain-object result (no class instances) so it crosses
 * the server→client boundary safely.
 */

export type TriggerGmailSyncResult =
  | { ok: true; message: string; inserted: number; users: number }
  | { ok: false; error: string };

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const BACKFILL_DAYS = 14;
const BATCH_EMAILS_PER_QUERY = 20;
const MAX_MESSAGES_PER_RUN = 100; // cap to keep server action fast

interface GmailMessageStub {
  id: string;
  threadId?: string;
}

interface HeaderEntry {
  name?: string;
  value?: string;
}

async function gmailFetch(
  accessToken: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail GET ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function listMessageIds(
  accessToken: string,
  query: string,
): Promise<GmailMessageStub[]> {
  const params = new URLSearchParams({ q: query, maxResults: "100" });
  const json = await gmailFetch(
    accessToken,
    `/gmail/v1/users/me/messages?${params.toString()}`,
  );
  return (json.messages as GmailMessageStub[] | undefined) ?? [];
}

async function getMessageMetadata(
  accessToken: string,
  id: string,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date", "X-Failed-Recipients"]) {
    params.append("metadataHeaders", h);
  }
  return gmailFetch(
    accessToken,
    `/gmail/v1/users/me/messages/${id}?${params.toString()}`,
  );
}

function headerValue(headers: HeaderEntry[] | undefined, name: string): string | null {
  const row = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return row?.value || null;
}

function classifyMessage(
  msg: Record<string, unknown>,
  partnerEmail: string,
): { direction: string; eventType: string } | null {
  const labelIds = (msg.labelIds as string[]) || [];
  const payload = msg.payload as { headers?: HeaderEntry[] } | undefined;
  const headers = payload?.headers || [];
  const from = (headerValue(headers, "From") || "").toLowerCase();

  const isSent = labelIds.includes("SENT");
  const isInbox = labelIds.includes("INBOX");
  const isChat = labelIds.includes("CHAT");

  const xFailed = headerValue(headers, "X-Failed-Recipients");
  if (
    xFailed ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster@") ||
    from.includes("mail delivery subsystem")
  ) {
    return { direction: "bounce", eventType: "bounce" };
  }

  const subject = (headerValue(headers, "Subject") || "").toLowerCase();
  if (
    subject.startsWith("out of office") ||
    subject.startsWith("auto-reply") ||
    subject.startsWith("automatic reply") ||
    subject.includes("out of the office")
  ) {
    return { direction: "auto_reply", eventType: "ooo" };
  }

  if (isSent) return { direction: "outbound", eventType: "sent" };
  if (isInbox) return { direction: "inbound", eventType: "reply" };
  if (isChat) return null;
  if (partnerEmail && from.includes(partnerEmail.toLowerCase())) {
    return { direction: "inbound", eventType: "reply" };
  }
  return { direction: "outbound", eventType: "sent" };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function triggerGmailSync(): Promise<TriggerGmailSyncResult> {
  const supabase = createAdminClient();

  // Load all gmail_tokens rows
  const { data: tokens, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select(
      "user_id, email, access_token, refresh_token, expires_at, scope, last_gmail_sync_at",
    );
  if (tokenErr) {
    return { ok: false, error: `gmail_tokens read failed: ${tokenErr.message}` };
  }
  if (!tokens || tokens.length === 0) {
    return { ok: false, error: "No Gmail accounts connected — connect Gmail first." };
  }

  // Load campaign partners with emails
  const partnersByEmail = new Map<string, string[]>();
  const { data: partnersData, error: partnerErr } = await supabase
    .from("campaign_partners")
    .select("id, partner_id, partners_mirror!inner(email)")
    .not("partners_mirror.email", "is", null)
    .range(0, 999);
  if (partnerErr) {
    return { ok: false, error: `campaign_partners read failed: ${partnerErr.message}` };
  }
  for (const row of partnersData ?? []) {
    const mirror = row.partners_mirror as { email?: string } | null;
    const email = mirror?.email?.trim()?.toLowerCase();
    if (!email) continue;
    if (!partnersByEmail.has(email)) partnersByEmail.set(email, []);
    partnersByEmail.get(email)!.push(row.id);
  }

  let totalInserted = 0;
  let processedUsers = 0;

  for (const tokenRow of tokens) {
    // Scope check
    const scope = ((tokenRow.scope as string) || "").split(/\s+/);
    if (!scope.includes(REQUIRED_SCOPE)) continue;

    // Ensure fresh access token
    let accessToken: string;
    try {
      const now = Date.now();
      const expires = tokenRow.expires_at
        ? new Date(tokenRow.expires_at as string).getTime()
        : 0;
      if (tokenRow.access_token && expires > now + 60_000) {
        accessToken = tokenRow.access_token as string;
      } else {
        const refreshed = await refreshAccessToken(tokenRow.refresh_token as string);
        await supabase
          .from("gmail_tokens")
          .update({
            access_token: refreshed.access_token,
            expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", tokenRow.user_id);
        accessToken = refreshed.access_token;
      }
    } catch {
      continue;
    }

    // Cursor: previous sync timestamp, fallback to BACKFILL_DAYS ago
    const cursorMs = tokenRow.last_gmail_sync_at
      ? new Date(tokenRow.last_gmail_sync_at as string).getTime()
      : Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
    const afterEpoch = Math.floor(cursorMs / 1000);
    const runStartedAt = new Date();

    const emails = [...partnersByEmail.keys()];
    const emailBatches = chunkArray(emails, BATCH_EMAILS_PER_QUERY);
    const seenMessageIds = new Set<string>();

    for (const batch of emailBatches) {
      if (seenMessageIds.size >= MAX_MESSAGES_PER_RUN) break;
      const orClause = batch.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
      const q = `(${orClause}) after:${afterEpoch} -in:chat`;
      try {
        const ids = await listMessageIds(accessToken, q);
        for (const m of ids) {
          seenMessageIds.add(m.id);
          if (seenMessageIds.size >= MAX_MESSAGES_PER_RUN) break;
        }
      } catch {
        // batch failed — continue with the rest
      }
    }

    let inserted = 0;
    let errored = 0;

    for (const messageId of [...seenMessageIds]) {
      let meta: Record<string, unknown>;
      try {
        meta = await getMessageMetadata(accessToken, messageId);
      } catch {
        errored++;
        continue;
      }

      const payload = meta.payload as { headers?: HeaderEntry[] } | undefined;
      const headers = payload?.headers || [];
      const from = (headerValue(headers, "From") || "").toLowerCase();
      const to = (headerValue(headers, "To") || "").toLowerCase();
      const subject = headerValue(headers, "Subject") || "";
      const dateHeader = headerValue(headers, "Date");

      let partnerEmail: string | null = null;
      let campaignPartnerIds: string[] | null = null;
      for (const [email, ids] of partnersByEmail) {
        if (from.includes(email) || to.includes(email)) {
          partnerEmail = email;
          campaignPartnerIds = ids;
          break;
        }
      }
      if (!partnerEmail || !campaignPartnerIds?.length) continue;

      const cls = classifyMessage(meta, partnerEmail);
      if (!cls) continue;

      let eventAt = new Date();
      if (meta.internalDate) {
        eventAt = new Date(Number(meta.internalDate));
      } else if (dateHeader) {
        const parsed = Date.parse(dateHeader);
        if (!Number.isNaN(parsed)) eventAt = new Date(parsed);
      }

      const row = {
        campaign_partner_id: campaignPartnerIds[0],
        direction: cls.direction,
        channel: "gmail",
        gmail_thread_id: (meta.threadId as string) || null,
        gmail_message_id: meta.id as string,
        event_type: cls.eventType,
        event_at: eventAt.toISOString(),
        summary: subject.slice(0, 500),
      };

      const { error } = await supabase
        .from("contact_events")
        .upsert(row, { onConflict: "gmail_message_id", ignoreDuplicates: true });
      if (error) {
        errored++;
      } else {
        inserted++;
      }
    }

    // Advance cursor only when clean
    const update: Record<string, unknown> = {
      last_gmail_sync_status: errored === 0 ? "ok" : "partial",
      last_gmail_sync_error: errored === 0 ? null : `${errored} errors in manual sync`,
      updated_at: new Date().toISOString(),
    };
    if (errored === 0) {
      update.last_gmail_sync_at = runStartedAt.toISOString();
    }
    await supabase
      .from("gmail_tokens")
      .update(update)
      .eq("user_id", tokenRow.user_id);

    totalInserted += inserted;
    processedUsers++;
  }

  return {
    ok: true,
    message: `Sync complete — checked ${processedUsers} connected account${processedUsers === 1 ? "" : "s"}.`,
    inserted: totalInserted,
    users: processedUsers,
  };
}
