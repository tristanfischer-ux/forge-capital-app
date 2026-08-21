#!/usr/bin/env node
/**
 * One-shot backfill: Gmail + Calendar → engage.activities.
 * Uses kgkajat tokens, writes to Corpus. Never prints secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[line.slice(0, i).trim()] = v;
  }
}
loadEnv();

const kg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const core = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  auth: { persistSession: false },
  db: { schema: "core" },
});
const engage = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  auth: { persistSession: false },
  db: { schema: "engage" },
});

async function loadBookPeopleByEmail() {
  const map = new Map();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await core
      .from("people")
      .select("id, firm_id, email, full_name")
      .not("email", "is", null)
      .range(from, from + 999);
    if (error || !data) break;
    for (const p of data) {
      const email = String(p.email ?? "").trim().toLowerCase();
      if (email) map.set(email, p);
    }
    if (data.length < 1000) break;
  }
  return map;
}

function extractEmails(blob) {
  return blob.toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) ?? [];
}

async function recordBookActivity(opts) {
  const { data: existing } = await engage
    .from("activities")
    .select("id")
    .eq("source_id", opts.sourceId)
    .maybeSingle();
  if (existing?.id) return "exists";
  const hits = [];
  const seen = new Set();
  for (const email of extractEmails(opts.fromToBlob)) {
    const person = opts.peopleByEmail.get(email);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      hits.push(person);
    }
  }
  if (!hits.length) {
    const domains = [
      ...new Set(extractEmails(opts.fromToBlob).map((e) => e.split("@")[1]).filter(Boolean)),
    ];
    for (const d of domains) {
      if (["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com"].includes(d))
        continue;
      const { data: firm } = await core
        .from("firms")
        .select("id")
        .eq("website_domain", d)
        .maybeSingle();
      if (firm?.id) {
        const { data: activity, error } = await engage
          .from("activities")
          .insert({
            occurred_at: opts.occurredAt,
            channel: opts.channel,
            subject: (opts.subject ?? "").slice(0, 500),
            snippet: opts.snippet ?? null,
            source_id: opts.sourceId,
            match_confidence: 0.6,
            created_by: "app",
          })
          .select("id")
          .maybeSingle();
        if (error) {
          if (/unique|duplicate/i.test(error.message)) return "exists";
          throw new Error(error.message);
        }
        await engage.from("activity_links").insert({
          activity_id: activity.id,
          entity_type: "firm",
          entity_id: firm.id,
          link_source: "auto",
        });
        return "inserted";
      }
    }
    return "unmatched";
  }
  const { data: activity, error } = await engage
    .from("activities")
    .insert({
      occurred_at: opts.occurredAt,
      channel: opts.channel,
      subject: (opts.subject ?? "").slice(0, 500),
      snippet: opts.snippet ?? null,
      source_id: opts.sourceId,
      match_confidence: 1,
      created_by: "app",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (/unique|duplicate/i.test(error.message)) return "exists";
    throw new Error(error.message);
  }
  const links = [];
  const firms = new Set();
  for (const p of hits) {
    links.push({ activity_id: activity.id, entity_type: "person", entity_id: p.id, link_source: "auto" });
    if (p.firm_id && !firms.has(p.firm_id)) {
      firms.add(p.firm_id);
      links.push({ activity_id: activity.id, entity_type: "firm", entity_id: p.firm_id, link_source: "auto" });
    }
  }
  if (links.length) await engage.from("activity_links").insert(links);
  return "inserted";
}

async function markFeed(feed) {
  await engage
    .from("sync_state")
    .update({ last_ok_at: new Date().toISOString(), last_error: null })
    .eq("feed", feed);
}

async function refresh(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status} ${await res.text()}`);
  return res.json();
}

async function gmailList(token, q) {
  const ids = [];
  let page;
  do {
    const params = new URLSearchParams({ q, maxResults: "100" });
    if (page) params.set("pageToken", page);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`gmail list ${res.status}`);
    const json = await res.json();
    for (const m of json.messages ?? []) ids.push(m.id);
    page = json.nextPageToken;
    if (ids.length >= 400) break;
  } while (page);
  return ids;
}

async function gmailMeta(token, id) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Subject", "Date"]) params.append("metadataHeaders", h);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`gmail meta ${res.status}`);
  return res.json();
}

function header(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

const { data: tokens, error } = await kg.from("gmail_tokens").select("*");
if (error) throw new Error(error.message);
const people = await loadBookPeopleByEmail();
console.log("book_people_with_email", people.size, "token_rows", tokens?.length ?? 0);

const after = Math.floor((Date.now() - 14 * 86400000) / 1000);
const tally = { mail_listed: 0, mail_inserted: 0, mail_exists: 0, mail_unmatched: 0, cal_inserted: 0, cal_unmatched: 0 };

for (const row of tokens ?? []) {
  const refreshed = await refresh(row.refresh_token);
  const access = refreshed.access_token;
  let ids = [];
  try {
    ids = await gmailList(access, `newer_than:14d -in:chat`);
  } catch (e) {
    console.error("gmail list", e.message);
  }
  tally.mail_listed += ids.length;
  for (const id of ids) {
      let meta;
      try {
        meta = await gmailMeta(access, id);
      } catch {
        continue;
      }
      const headers = meta.payload?.headers ?? [];
      const from = header(headers, "From").toLowerCase();
      const to = header(headers, "To").toLowerCase();
      const subject = header(headers, "Subject");
      const labels = meta.labelIds ?? [];
      const channel = labels.includes("SENT") ? "email_out" : "email_in";
      const occurred = meta.internalDate
        ? new Date(Number(meta.internalDate)).toISOString()
        : new Date().toISOString();
      try {
        const r = await recordBookActivity({
          sourceId: `gmail:${id}`,
          occurredAt: occurred,
          channel,
          subject,
          snippet: subject,
          fromToBlob: `${from} ${to}`,
          peopleByEmail: people,
        });
        if (r === "inserted") tally.mail_inserted += 1;
        else if (r === "exists") tally.mail_exists += 1;
        else if (r === "unmatched") tally.mail_unmatched += 1;
      } catch (e) {
        console.error("record mail", e.message);
      }
    }

  const calFrom = new Date(Date.now() - 14 * 86400000).toISOString();
  const calTo = new Date(Date.now() + 14 * 86400000).toISOString();
  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin", calFrom);
  calUrl.searchParams.set("timeMax", calTo);
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy", "startTime");
  calUrl.searchParams.set("maxResults", "100");
  const calRes = await fetch(calUrl, { headers: { Authorization: `Bearer ${access}` } });
  if (calRes.ok) {
    const body = await calRes.json();
    for (const event of body.items ?? []) {
      const start = event.start?.dateTime ?? event.start?.date;
      if (!start || !event.id) continue;
      const blob = (event.attendees ?? []).map((a) => a.email ?? "").join(" ");
      try {
        const r = await recordBookActivity({
          sourceId: `cal:${event.id}`,
          occurredAt: new Date(start).toISOString(),
          channel: "calendar",
          subject: event.summary ?? "(untitled)",
          snippet: (event.description ?? event.summary ?? "").slice(0, 500),
          fromToBlob: blob,
          peopleByEmail: people,
        });
        if (r === "inserted") tally.cal_inserted += 1;
        else if (r === "unmatched") tally.cal_unmatched += 1;
      } catch (e) {
        console.error("record cal", e.message);
      }
    }
  } else {
    console.error("calendar", calRes.status, await calRes.text());
  }
}

await markFeed("gmail");
await markFeed("calendar");
console.log(tally);
