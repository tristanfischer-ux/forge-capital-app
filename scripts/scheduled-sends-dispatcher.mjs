#!/usr/bin/env node
/**
 * Scheduled-sends dispatcher daemon.
 *
 * Polls `public.scheduled_sends` every 60 seconds for rows whose
 * `scheduled_for_utc <= now()` and `status = 'pending'`. For each
 * due row:
 *
 *   1. Atomically flip status → 'dispatching' (prevents double-send
 *      if two dispatchers were ever running).
 *   2. Call Gmail's messages/send API with the row's to/subject/body.
 *      MX pre-flight runs inline — bounces are caught before Gmail.
 *   3. On success: status → 'sent', gmail_thread_id + gmail_message_id
 *      set, plus a mirror row in `contact_events` with event_type =
 *      'scheduled_send' so the tracker timeline reflects the send.
 *   4. On failure: status → 'failed', error_message set.
 *
 * Design doc: docs/design-scheduled-sends.md.
 *
 * Runs forever. Killed by launchd on system restart, by SIGTERM
 * otherwise. One-line log per polling cycle even on empty batches so
 * the log file proves the daemon is alive.
 *
 * Env (read from .env.local if not already in the environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   HUNTER_API_KEY (optional — enables real SMTP probe pre-flight)
 *
 * Run manually:
 *   node scripts/scheduled-sends-dispatcher.mjs
 *   node scripts/scheduled-sends-dispatcher.mjs --once    # single poll, then exit
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMx } from "node:dns/promises";

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
const ONCE = argv.includes("--once");
const POLL_INTERVAL_MS = Number(process.env.SCHEDULED_SENDS_POLL_MS || 60_000);
const BATCH_LIMIT = Number(process.env.SCHEDULED_SENDS_BATCH_LIMIT || 10);

// ---------- Supabase admin client ----------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[scheduled-sends] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env. Aborting.",
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
    throw new Error(
      `Gmail token refresh failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

/**
 * The dispatcher runs as a service-role daemon — there is no logged-in
 * user. Pick the first (or only) gmail_tokens row as the sending
 * account. In V1 Tristan is the only connected user, so this is
 * unambiguous. If the team ever grows, `created_by` on the
 * scheduled_sends row identifies the intended sender and we'd route
 * by user_id here.
 */
async function getSenderAccessToken() {
  const { data: tokens, error } = await supabase
    .from("gmail_tokens")
    .select("user_id, email, access_token, refresh_token, expires_at, scope")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`gmail_tokens read: ${error.message}`);
  if (!tokens || tokens.length === 0) {
    throw new Error(
      "No gmail_tokens row — connect Gmail at /api/auth/gmail first.",
    );
  }
  const row = tokens[0];
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
    .eq("user_id", row.user_id);
  return refreshed.access_token;
}

// ---------- Deliverability pre-flight (MX + optional Hunter) ----------

async function verifyDeliverability(email) {
  // MX check first — free, fast, rules out invalid domains.
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !domain.includes(".")) {
    return { deliverable: false, reason: "Invalid email shape" };
  }
  try {
    const mx = await resolveMx(domain);
    if (!mx || mx.length === 0) {
      return { deliverable: false, reason: `No MX records for ${domain}` };
    }
  } catch (err) {
    return {
      deliverable: false,
      reason: `MX lookup failed for ${domain}: ${err?.message || String(err)}`,
    };
  }

  // Hunter SMTP probe — only when HUNTER_API_KEY is set.
  const hunterKey = process.env.HUNTER_API_KEY?.trim();
  if (hunterKey) {
    try {
      const url = new URL("https://api.hunter.io/v2/email-verifier");
      url.searchParams.set("email", email);
      url.searchParams.set("api_key", hunterKey);
      const res = await fetch(url.toString());
      if (!res.ok) {
        // Hunter outage shouldn't block sends — fall back to MX-pass.
        return { deliverable: true, reason: "Hunter outage, MX-only" };
      }
      const json = await res.json();
      const status = json?.data?.status;
      if (status === "valid" || status === "deliverable") {
        return { deliverable: true, reason: `Hunter: ${status}` };
      }
      return {
        deliverable: false,
        reason: `Hunter: ${status || "unknown"}`,
      };
    } catch {
      return { deliverable: true, reason: "Hunter error, MX-only" };
    }
  }

  return { deliverable: true, reason: "MX-only (HUNTER_API_KEY not set)" };
}

// ---------- Gmail send ----------

function encodeRfc2822Message(to, subject, body) {
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

async function sendGmailMessage(accessToken, to, subject, body) {
  const raw = encodeRfc2822Message(to, subject, body);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Gmail send failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

// ---------- main loop ----------

async function dispatchOnce() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("scheduled_sends")
    .select(
      "id, campaign_partner_id, to_email, subject, body, scheduled_for_utc",
    )
    .lte("scheduled_for_utc", nowIso)
    .eq("status", "pending")
    .order("scheduled_for_utc", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error(`[scheduled-sends] poll failed: ${error.message}`);
    return { sent: 0, failed: 0, total: 0 };
  }
  const rows = due ?? [];
  if (rows.length === 0) {
    console.log(`[scheduled-sends] ${nowIso} — no due rows`);
    return { sent: 0, failed: 0, total: 0 };
  }

  console.log(`[scheduled-sends] ${nowIso} — ${rows.length} due row(s)`);

  let accessToken;
  try {
    accessToken = await getSenderAccessToken();
  } catch (err) {
    console.error(
      `[scheduled-sends] cannot obtain Gmail access token: ${err?.message || err}`,
    );
    return { sent: 0, failed: 0, total: rows.length };
  }

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    // Atomic claim: flip pending → dispatching, but ONLY if still pending.
    // This prevents a double-send if two daemons ever race (and also
    // handles the case where a founder clicked Cancel between the poll
    // and the send).
    const { data: claimed, error: claimErr } = await supabase
      .from("scheduled_sends")
      .update({ status: "dispatching" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error(
        `[scheduled-sends] claim failed for ${row.id}: ${claimErr.message}`,
      );
      continue;
    }
    if (!claimed) {
      // Another dispatcher claimed it, or the founder cancelled.
      console.log(`[scheduled-sends] ${row.id} no longer pending — skipped`);
      continue;
    }

    try {
      const verification = await verifyDeliverability(row.to_email);
      if (!verification.deliverable) {
        throw new Error(
          `Deliverability check failed: ${verification.reason}`,
        );
      }

      const gmailRes = await sendGmailMessage(
        accessToken,
        row.to_email,
        row.subject,
        row.body,
      );
      const sentAt = new Date().toISOString();

      await supabase
        .from("scheduled_sends")
        .update({
          status: "sent",
          sent_at: sentAt,
          gmail_thread_id: gmailRes.threadId || null,
          gmail_message_id: gmailRes.id || null,
        })
        .eq("id", row.id);

      // Mirror to contact_events so the tracker timeline reflects the
      // send. event_type 'scheduled_send' distinguishes dispatcher-emitted
      // sends from interactive /tracker/[id]/draft sends ('sent') and
      // test batches ('test_send').
      await supabase.from("contact_events").insert({
        campaign_partner_id: row.campaign_partner_id,
        event_type: "scheduled_send",
        event_at: sentAt,
        direction: "outbound",
        channel: "gmail",
        gmail_thread_id: gmailRes.threadId || null,
        gmail_message_id: gmailRes.id || null,
        summary: row.subject.slice(0, 500),
      });

      sent += 1;
      console.log(
        `[scheduled-sends] ✓ sent ${row.id} to ${row.to_email} thread=${gmailRes.threadId}`,
      );
    } catch (err) {
      const msg = err?.message || String(err);
      await supabase
        .from("scheduled_sends")
        .update({
          status: "failed",
          error_message: msg.slice(0, 2000),
        })
        .eq("id", row.id);
      failed += 1;
      console.error(
        `[scheduled-sends] ✗ failed ${row.id} to ${row.to_email}: ${msg}`,
      );
    }
  }

  console.log(
    `[scheduled-sends] batch done — sent=${sent} failed=${failed} total=${rows.length}`,
  );
  return { sent, failed, total: rows.length };
}

async function main() {
  console.log(
    `[scheduled-sends] daemon start ${new Date().toISOString()} once=${ONCE} pollMs=${POLL_INTERVAL_MS} batchLimit=${BATCH_LIMIT}`,
  );

  if (ONCE) {
    await dispatchOnce();
    return;
  }

  // Forever loop. launchd restarts us on crash.
  // Use setTimeout rather than setInterval so a slow Gmail batch
  // doesn't cause overlapping polls.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await dispatchOnce();
    } catch (err) {
      console.error(
        `[scheduled-sends] unhandled in dispatchOnce: ${err?.stack || err}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(`[scheduled-sends] unhandled error: ${err?.stack || err}`);
  process.exit(1);
});
