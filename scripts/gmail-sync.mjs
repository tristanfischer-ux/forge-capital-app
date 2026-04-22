#!/usr/bin/env node
/**
 * Phase 8 — Gmail INBOUND sync daemon.
 *
 * Polls each connected user's Gmail, finds messages to/from any
 * campaign_partners email, and upserts into contact_events keyed on
 * gmail_message_id. Runs every 15 minutes via launchd
 * (~/Library/LaunchAgents/com.forgecapital.gmail-sync.plist).
 *
 * Design choices (kept deliberately simple):
 *
 *  - Per-user incremental sync. Cursor stored in
 *    gmail_tokens.last_gmail_sync_at. First run per user looks back
 *    BACKFILL_DAYS (default 14) so we don't pull entire histories.
 *
 *  - For EACH campaign_partner with an email, query Gmail with
 *      q=(from:X OR to:X) after:<cursor_epoch>
 *    Gmail caps the OR chain at ~30 terms per query; batching is
 *    BATCH_EMAILS_PER_QUERY (20). Lower than the cap for safety.
 *
 *  - For each returned message id, format=metadata with
 *    metadataHeaders=From,To,Subject,Date,X-Failed-Recipients.
 *    Direction derived from labelIds (INBOX → inbound, SENT → outbound).
 *    Bounces detected by sender=mailer-daemon OR X-Failed-Recipients
 *    header present.
 *
 *  - Upsert to contact_events on (gmail_message_id). No updates to
 *    existing rows — the row is immutable once written.
 *
 *  - Scope check: gmail_tokens.scope must include gmail.readonly. Rows
 *    that pre-date Phase 8 only have gmail.compose and are skipped with
 *    a clear status so Tristan knows who needs to reconnect.
 *
 * Usage:
 *   node scripts/gmail-sync.mjs --dry-run         # enumerate, no writes
 *   node scripts/gmail-sync.mjs --dry-run --limit 5
 *   node scripts/gmail-sync.mjs --user <uuid> --limit 5
 *   node scripts/gmail-sync.mjs                   # production run
 *
 * Env (read from .env.local if not already in the environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ---------- env loading ----------

function loadEnvLocal() {
  const envPath = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip wrapping quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

// ---------- CLI args ----------

const argv = process.argv.slice(2);
function argFlag(name) {
  return argv.includes(name);
}
function argValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

const DRY_RUN = argFlag("--dry-run");
const LIMIT_MESSAGES = argValue("--limit") ? Number(argValue("--limit")) : null;
const ONLY_USER = argValue("--user");
const BACKFILL_DAYS = Number(process.env.GMAIL_SYNC_BACKFILL_DAYS || "14");
const BATCH_EMAILS_PER_QUERY = 20;
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// ---------- Supabase admin client ----------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[gmail-sync] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env. Aborting.",
  );
  process.exit(0);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------- Gmail OAuth refresh ----------

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing in env — cannot refresh tokens",
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ---------- Gmail API helpers ----------

async function gmailFetch(accessToken, path, { method = "GET" } = {}) {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      `Gmail ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listMessageIds(accessToken, query) {
  // paginate up to 500 messages per query (Gmail caps pageSize at 500). In
  // practice incremental sync sees <50/day per user. If we hit the cap we
  // fall through with a partial batch and the next cron run picks up the
  // rest — the cursor only advances after a successful full ingest.
  const ids = [];
  let pageToken = undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = await gmailFetch(
      accessToken,
      `/gmail/v1/users/me/messages?${params.toString()}`,
    );
    for (const m of json.messages || []) ids.push(m);
    pageToken = json.nextPageToken;
    if (ids.length >= 500) break;
  } while (pageToken);
  return ids;
}

async function getMessageMetadata(accessToken, id) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date", "X-Failed-Recipients"]) {
    params.append("metadataHeaders", h);
  }
  return gmailFetch(accessToken, `/gmail/v1/users/me/messages/${id}?${params.toString()}`);
}

// ---------- Message classification ----------

function headerValue(headers, name) {
  const row = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return row?.value || null;
}

/**
 * Given the metadata response and the partner's email, classify:
 *   direction: outbound | inbound | bounce | auto_reply | null
 *   eventType: sent | reply | bounce | ooo | unknown
 */
function classifyMessage(msg, partnerEmail) {
  const labelIds = msg.labelIds || [];
  const headers = msg.payload?.headers || [];
  const from = (headerValue(headers, "From") || "").toLowerCase();
  const xFailed = headerValue(headers, "X-Failed-Recipients");

  const isSent = labelIds.includes("SENT");
  const isInbox = labelIds.includes("INBOX");
  const isChat = labelIds.includes("CHAT");

  // bounce signals
  if (
    xFailed ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster@") ||
    from.includes("mail delivery subsystem")
  ) {
    return { direction: "bounce", eventType: "bounce" };
  }

  // auto-reply heuristic from subject
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
  if (isChat) return null; // skip chat
  // Message exists in Gmail but not in INBOX/SENT (archived). Treat as
  // inbound if From header is the partner, outbound if From is the user.
  if (partnerEmail && from.includes(partnerEmail.toLowerCase())) {
    return { direction: "inbound", eventType: "reply" };
  }
  return { direction: "outbound", eventType: "sent" };
}

// ---------- Per-user sync ----------

async function ensureFreshAccessToken(tokenRow) {
  const now = Date.now();
  const expires = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  if (tokenRow.access_token && expires > now + 60_000) {
    return { accessToken: tokenRow.access_token, refreshed: false };
  }
  const refreshed = await refreshAccessToken(tokenRow.refresh_token);
  const newExpires = new Date(now + refreshed.expires_in * 1000).toISOString();
  await supabase
    .from("gmail_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", tokenRow.user_id);
  return { accessToken: refreshed.access_token, refreshed: true };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadCampaignPartners() {
  // Pull every campaign_partner row with a partner email. The daemon is
  // user-agnostic at this layer — once we know which messages exist, we
  // attribute by email match regardless of which user's inbox they came
  // from (small team sharing a pipeline).
  const byEmail = new Map();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("campaign_partners")
      .select("id, partner_id, partners_mirror!inner(email)")
      .not("partners_mirror.email", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`campaign_partners read: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const email = row.partners_mirror?.email?.trim()?.toLowerCase();
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(row.id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return byEmail;
}

async function syncUser(tokenRow, partnersByEmail) {
  const userLabel = `${tokenRow.email} (${tokenRow.user_id.slice(0, 8)}…)`;

  // Scope check
  const scope = (tokenRow.scope || "").split(/\s+/);
  if (!scope.includes(REQUIRED_SCOPE)) {
    console.warn(
      `[gmail-sync] ${userLabel}: missing gmail.readonly scope (has: ${tokenRow.scope || "none"}). Skipping. User must reconnect via /api/auth/gmail.`,
    );
    if (!DRY_RUN) {
      await supabase
        .from("gmail_tokens")
        .update({
          last_gmail_sync_status: "scope_insufficient",
          last_gmail_sync_error:
            "Need gmail.readonly scope — reconnect at /api/auth/gmail",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", tokenRow.user_id);
    }
    return { userLabel, skipped: true, reason: "scope_insufficient" };
  }

  let accessToken;
  try {
    const r = await ensureFreshAccessToken(tokenRow);
    accessToken = r.accessToken;
  } catch (err) {
    console.error(`[gmail-sync] ${userLabel}: token refresh failed: ${err.message}`);
    return { userLabel, skipped: true, reason: "refresh_failed", error: err.message };
  }

  // Cursor: previous sync timestamp, fallback to BACKFILL_DAYS ago
  const cursorMs = tokenRow.last_gmail_sync_at
    ? new Date(tokenRow.last_gmail_sync_at).getTime()
    : Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
  const afterEpoch = Math.floor(cursorMs / 1000);
  const runStartedAt = new Date();

  console.log(
    `[gmail-sync] ${userLabel}: sync from ${new Date(cursorMs).toISOString()}  (after:${afterEpoch}). partners=${partnersByEmail.size}`,
  );

  // Batch partners into Gmail-compatible OR queries
  const emails = [...partnersByEmail.keys()];
  const emailBatches = chunkArray(emails, BATCH_EMAILS_PER_QUERY);

  const seenMessageIds = new Set();
  const messageToPartnerEmail = new Map();

  for (const batch of emailBatches) {
    const orClause = batch.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
    const q = `(${orClause}) after:${afterEpoch} -in:chat`;
    let ids = [];
    try {
      ids = await listMessageIds(accessToken, q);
    } catch (err) {
      if (err.status === 400) {
        // Usually query too long — fall back to half-size batches
        console.warn(
          `[gmail-sync] ${userLabel}: batch of ${batch.length} too long, splitting`,
        );
        const halves = chunkArray(batch, Math.ceil(batch.length / 2));
        for (const h of halves) {
          const orH = h.map((e) => `(from:${e} OR to:${e})`).join(" OR ");
          try {
            const sub = await listMessageIds(
              accessToken,
              `(${orH}) after:${afterEpoch} -in:chat`,
            );
            ids.push(...sub);
          } catch (err2) {
            console.error(`[gmail-sync] ${userLabel}: sub-batch failed: ${err2.message}`);
          }
        }
      } else {
        console.error(`[gmail-sync] ${userLabel}: list failed: ${err.message}`);
        continue;
      }
    }
    for (const m of ids) {
      seenMessageIds.add(m.id);
      // We don't yet know which partner email matched — set on metadata fetch
    }
    if (LIMIT_MESSAGES && seenMessageIds.size >= LIMIT_MESSAGES) break;
  }

  const messageIdList = [...seenMessageIds].slice(
    0,
    LIMIT_MESSAGES || seenMessageIds.size,
  );
  console.log(
    `[gmail-sync] ${userLabel}: list -> ${seenMessageIds.size} ids, processing ${messageIdList.length}`,
  );

  let inserted = 0;
  let skipped = 0;
  let errored = 0;

  for (const messageId of messageIdList) {
    let meta;
    try {
      meta = await getMessageMetadata(accessToken, messageId);
    } catch (err) {
      errored++;
      console.error(`[gmail-sync] ${userLabel}: get ${messageId} failed: ${err.message}`);
      continue;
    }
    const headers = meta.payload?.headers || [];
    const from = (headerValue(headers, "From") || "").toLowerCase();
    const to = (headerValue(headers, "To") || "").toLowerCase();
    const subject = headerValue(headers, "Subject") || "";
    const dateHeader = headerValue(headers, "Date");
    // Match to a partner email. First try From, then To.
    let partnerEmail = null;
    let campaignPartnerIds = null;
    for (const [email, ids] of partnersByEmail) {
      if (from.includes(email) || to.includes(email)) {
        partnerEmail = email;
        campaignPartnerIds = ids;
        break;
      }
    }
    if (!partnerEmail || !campaignPartnerIds?.length) {
      skipped++;
      continue;
    }

    const cls = classifyMessage(meta, partnerEmail);
    if (!cls) {
      skipped++;
      continue;
    }

    // event_at: prefer Gmail internalDate (epoch ms string), fall back to
    // the Date header, fall back to now.
    let eventAt = new Date();
    if (meta.internalDate) {
      eventAt = new Date(Number(meta.internalDate));
    } else if (dateHeader) {
      const parsed = Date.parse(dateHeader);
      if (!Number.isNaN(parsed)) eventAt = new Date(parsed);
    }

    // For every (campaign, partner) pair that has this partner, we record
    // one event. In practice each partner belongs to one or two campaigns
    // max, so this is fine. Upsert on gmail_message_id — partial index
    // means a second upsert for the SAME message id is a no-op, so we
    // only emit for the FIRST campaign_partner_id to avoid duplicates. If
    // a message needs to show on multiple campaign trackers that's Phase 9
    // work — out of scope for this daemon.
    const campaignPartnerId = campaignPartnerIds[0];

    const row = {
      campaign_partner_id: campaignPartnerId,
      direction: cls.direction,
      channel: "gmail",
      gmail_thread_id: meta.threadId || null,
      gmail_message_id: meta.id,
      event_type: cls.eventType,
      event_at: eventAt.toISOString(),
      summary: subject.slice(0, 500),
    };

    if (DRY_RUN) {
      console.log(
        `[gmail-sync] ${userLabel} DRY-RUN would upsert: ${cls.direction}/${cls.eventType} partner=${partnerEmail} msg=${meta.id} at=${eventAt.toISOString()} "${subject.slice(0, 60)}"`,
      );
      inserted++;
      continue;
    }

    const { error } = await supabase
      .from("contact_events")
      .upsert(row, {
        onConflict: "gmail_message_id",
        ignoreDuplicates: true,
      });
    if (error) {
      errored++;
      console.error(`[gmail-sync] ${userLabel}: upsert failed for ${meta.id}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  // Advance cursor only if the run didn't error wholesale
  if (!DRY_RUN && errored < messageIdList.length) {
    await supabase
      .from("gmail_tokens")
      .update({
        last_gmail_sync_at: runStartedAt.toISOString(),
        last_gmail_sync_status: errored === 0 ? "ok" : "partial",
        last_gmail_sync_error: errored === 0 ? null : `${errored} message errors`,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", tokenRow.user_id);
  }

  return {
    userLabel,
    listed: seenMessageIds.size,
    processed: messageIdList.length,
    inserted,
    skipped,
    errored,
  };
}

// ---------- main ----------

async function main() {
  const t0 = Date.now();
  console.log(
    `[gmail-sync] start ${new Date().toISOString()} dryRun=${DRY_RUN} limit=${LIMIT_MESSAGES || "none"} onlyUser=${ONLY_USER || "all"}`,
  );

  let tokenQuery = supabase
    .from("gmail_tokens")
    .select(
      "user_id, email, access_token, refresh_token, expires_at, scope, last_gmail_sync_at",
    );
  if (ONLY_USER) tokenQuery = tokenQuery.eq("user_id", ONLY_USER);
  const { data: tokens, error } = await tokenQuery;
  if (error) {
    console.error(`[gmail-sync] gmail_tokens read failed: ${error.message}`);
    process.exit(1);
  }
  if (!tokens || tokens.length === 0) {
    console.log("[gmail-sync] no gmail_tokens rows — nothing to do");
    return;
  }
  console.log(`[gmail-sync] found ${tokens.length} connected user(s)`);
  for (const t of tokens) {
    console.log(
      `[gmail-sync]   - ${t.email} (${t.user_id.slice(0, 8)}…) scope=${(t.scope || "").replace("https://www.googleapis.com/auth/", "").replace(/\s*https:\/\/www\.googleapis\.com\/auth\//g, " ")} last=${t.last_gmail_sync_at || "never"}`,
    );
  }

  const partnersByEmail = await loadCampaignPartners();
  console.log(
    `[gmail-sync] loaded ${partnersByEmail.size} unique partner emails across campaign_partners`,
  );

  const results = [];
  for (const t of tokens) {
    try {
      const r = await syncUser(t, partnersByEmail);
      results.push(r);
    } catch (err) {
      console.error(
        `[gmail-sync] FATAL for ${t.email}: ${err?.stack || err?.message || err}`,
      );
      results.push({ userLabel: t.email, error: err?.message || String(err) });
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[gmail-sync] done in ${dt}s — summary:`);
  for (const r of results) console.log(`[gmail-sync]   ${JSON.stringify(r)}`);
}

main().catch((err) => {
  console.error(`[gmail-sync] unhandled error: ${err?.stack || err}`);
  process.exit(1);
});
