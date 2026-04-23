#!/usr/bin/env node
/*
 * calendar-sync.mjs — Google Calendar auto-ingest daemon.
 *
 * Reads Tristan's primary calendar and, for every event whose
 * attendees include an email that matches a row in partners_mirror,
 * inserts a contact_events row of type "meeting" so the CRM
 * timeline picks it up automatically. Dedup via
 * contact_events.google_calendar_event_id (unique partial index
 * created by migration 024).
 *
 * Runs from launchd on Tristan's Mac every 10 minutes. Logs a
 * per-user cursor so we only fetch deltas, not the full calendar
 * every time.
 *
 * Requires: gmail_tokens row has scope
 * https://www.googleapis.com/auth/calendar.readonly (granted via the
 * updated GMAIL_SCOPES constant; users who linked before that must
 * re-authorise at /api/auth/gmail).
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    "calendar-sync: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(2);
}
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    "calendar-sync: missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET — cannot refresh access tokens",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

/* ------------------------ token refresh --------------------------- */

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `refreshAccessToken: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

async function getAccessTokenForRow(row) {
  const now = Date.now();
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expires > now + 60_000) return row.access_token;
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

/* ----------------------- calendar fetch --------------------------- */

/**
 * Fetch events from primary calendar since `fromIso`. Uses
 * timeMin + singleEvents=true to flatten recurring events.
 */
async function fetchPrimaryEvents(accessToken, fromIso) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", fromIso);
  url.searchParams.set(
    "timeMax",
    new Date(Date.now() + 14 * 86_400_000).toISOString(),
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    throw new Error("calendar_scope_insufficient");
  }
  if (!res.ok) {
    throw new Error(
      `calendar.events.list: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = await res.json();
  return Array.isArray(body.items) ? body.items : [];
}

/* -------------------- partner matching --------------------------- */

async function matchPartnersByEmails(emails) {
  if (!emails.length) return new Map();
  // Lowercase everything for case-insensitive match.
  const normalised = emails.map((e) => e.toLowerCase());
  const { data, error } = await supabase
    .from("partners_mirror")
    .select("id, email")
    .in("email", normalised);
  if (error) {
    console.error("matchPartnersByEmails failed:", error.message);
    return new Map();
  }
  const byEmail = new Map();
  for (const r of data ?? []) {
    if (r.email) byEmail.set(r.email.toLowerCase(), r.id);
  }
  return byEmail;
}

async function mostRecentCampaignPartner(partnerId) {
  const { data } = await supabase
    .from("campaign_partners")
    .select("id")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? data.id : null;
}

/* -------------------- event → contact_events --------------------- */

function inferChannel(event) {
  const hangoutLink = event.hangoutLink || "";
  const location = (event.location || "").toLowerCase();
  const conf = event.conferenceData?.conferenceSolution?.name ?? "";
  if (hangoutLink.includes("meet.google.com") || conf.toLowerCase().includes("google meet")) {
    return "google_meet";
  }
  if (location.includes("zoom") || conf.toLowerCase().includes("zoom")) {
    return "zoom";
  }
  if (location.includes("teams") || conf.toLowerCase().includes("teams")) {
    return "teams";
  }
  if (!hangoutLink && !location) return "call";
  return "in_person";
}

function durationMinutes(event) {
  const start =
    event.start?.dateTime ?? event.start?.date ?? null;
  const end = event.end?.dateTime ?? event.end?.date ?? null;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60_000);
}

async function ingestEvent(event, partnerId) {
  const campaignPartnerId = await mostRecentCampaignPartner(partnerId);
  if (!campaignPartnerId) {
    console.warn(
      `calendar-sync: partner ${partnerId} has no campaign_partners row — skipping event ${event.id}`,
    );
    return "skipped_no_campaign";
  }

  const title = event.summary ?? "(untitled)";
  const notes = event.description ?? null;
  const startIso =
    event.start?.dateTime ?? event.start?.date ?? null;
  if (!startIso) return "skipped_no_start";
  const channel = inferChannel(event);
  const dur = durationMinutes(event);

  const { error } = await supabase.from("contact_events").insert({
    campaign_partner_id: campaignPartnerId,
    event_type: "meeting",
    event_at: new Date(startIso).toISOString(),
    direction: "meeting",
    channel,
    title,
    summary: title,
    notes,
    duration_minutes: dur,
    google_calendar_event_id: event.id,
  });

  if (error) {
    // Unique-violation on google_calendar_event_id — idempotent rerun,
    // fine, event already ingested.
    if (error.code === "23505" || /duplicate key/i.test(error.message)) {
      return "duplicate";
    }
    console.error(
      `calendar-sync insert failed for event ${event.id}:`,
      error.message,
    );
    return "failed";
  }

  // Bump last_contact_at on the campaign_partners row for tracker
  // "days since contact" accuracy.
  await supabase
    .from("campaign_partners")
    .update({ last_contact_at: new Date(startIso).toISOString() })
    .eq("id", campaignPartnerId);

  return "ingested";
}

/* --------------------- per-user sync run ------------------------- */

async function syncForUser(tokenRow) {
  let accessToken;
  try {
    accessToken = await getAccessTokenForRow(tokenRow);
  } catch (err) {
    console.error(
      `calendar-sync: refresh failed for ${tokenRow.user_id}: ${err.message}`,
    );
    return { user: tokenRow.user_id, error: err.message };
  }

  // Cursor: start 10 minutes before the last successful run, so we
  // pick up edits to events that were already in the window.
  const cursorRow = tokenRow.calendar_cursor ?? null;
  const fromIso = cursorRow
    ? new Date(new Date(cursorRow).getTime() - 10 * 60_000).toISOString()
    : new Date(Date.now() - 48 * 3600_000).toISOString(); // bootstrap: 48h back

  let events;
  try {
    events = await fetchPrimaryEvents(accessToken, fromIso);
  } catch (err) {
    if (err.message === "calendar_scope_insufficient") {
      console.error(
        `calendar-sync: user ${tokenRow.user_id} has not granted calendar.readonly — prompt to reconnect at /api/auth/gmail`,
      );
      return { user: tokenRow.user_id, error: "scope_insufficient" };
    }
    console.error(
      `calendar-sync: fetch failed for ${tokenRow.user_id}: ${err.message}`,
    );
    return { user: tokenRow.user_id, error: err.message };
  }

  const allEmails = [];
  for (const ev of events) {
    if (Array.isArray(ev.attendees)) {
      for (const a of ev.attendees) {
        if (a.email && !a.self) allEmails.push(a.email);
      }
    }
  }
  const partnerByEmail = await matchPartnersByEmails(allEmails);

  const counts = { ingested: 0, duplicate: 0, skipped: 0, failed: 0 };
  for (const ev of events) {
    const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
    let matchedPartnerId = null;
    for (const a of attendees) {
      if (a.email && !a.self) {
        const pid = partnerByEmail.get(a.email.toLowerCase());
        if (pid) {
          matchedPartnerId = pid;
          break;
        }
      }
    }
    if (!matchedPartnerId) continue;
    const outcome = await ingestEvent(ev, matchedPartnerId);
    if (outcome === "ingested") counts.ingested += 1;
    else if (outcome === "duplicate") counts.duplicate += 1;
    else if (outcome === "failed") counts.failed += 1;
    else counts.skipped += 1;
  }

  // Advance cursor only if no failures (matches gmail-sync pattern).
  if (counts.failed === 0) {
    await supabase
      .from("gmail_tokens")
      .update({
        calendar_cursor: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", tokenRow.user_id);
  }

  console.log(
    `calendar-sync user ${tokenRow.user_id}: ingested=${counts.ingested} dup=${counts.duplicate} skip=${counts.skipped} fail=${counts.failed} events=${events.length}`,
  );
  return { user: tokenRow.user_id, ...counts };
}

/* ------------------------ main loop ------------------------------ */

async function main() {
  const { data: tokens, error } = await supabase
    .from("gmail_tokens")
    .select(
      "user_id, access_token, refresh_token, expires_at, calendar_cursor",
    );
  if (error) {
    console.error("calendar-sync: gmail_tokens read failed:", error.message);
    process.exit(1);
  }
  if (!tokens?.length) {
    console.log("calendar-sync: no gmail_tokens rows — nothing to sync");
    return;
  }
  for (const row of tokens) {
    await syncForUser(row);
  }
}

main().catch((err) => {
  console.error("calendar-sync: fatal:", err);
  process.exit(1);
});
