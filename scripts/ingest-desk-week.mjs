#!/usr/bin/env node
/**
 * Fill the Raise desk week from a Google Calendar / Gmail dump.
 * Used when the stored Gmail OAuth refresh token is revoked and the
 * launchd daemons cannot run. Writes:
 *   data/desk-week.json          — Calendar + Inbox source for the UI
 *   contact_events               — matched meetings and inbound replies
 *
 * Usage:
 *   env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY \
 *     node scripts/ingest-desk-week.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
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
    process.env[key] = val;
  }
}
loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SELF = new Set([
  "tristan.fischer@gmail.com",
  "tristanfischer@gmail.com",
  "tristan@fractionalforge.app",
]);

function parseEmail(from) {
  if (!from) return null;
  const m = String(from).match(/<([^>]+)>/);
  const raw = (m ? m[1] : from).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

function parseName(from) {
  if (!from) return null;
  const m = String(from).match(/^([^<]+)</);
  const name = (m ? m[1] : from).replace(/"/g, "").trim();
  return name && !name.includes("@") ? name : null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function isNoiseMeeting(ev) {
  const t = (ev.summary || "").toLowerCase();
  if (ev.all_day) return true;
  if (/block off/.test(t)) return true;
  if (/b['’]?day|birthday/.test(t)) return true;
  if (/pick up/.test(t)) return true;
  if (/deadline/.test(t)) return true;
  return false;
}

function inferChannel(ev) {
  const blob = `${ev.location || ""} ${ev.description || ""}`.toLowerCase();
  if (blob.includes("meet.google") || blob.includes("google meet")) return "google_meet";
  if (blob.includes("zoom")) return "zoom";
  if (blob.includes("teams")) return "teams";
  if ((ev.location || "").trim()) return "in_person";
  return "meeting";
}

function guessNameFromTitle(title) {
  if (!title) return null;
  const andTf = title.match(/^(.+?)\s+and\s+Tristan/i);
  if (andTf) return andTf[1].trim();
  const paren = title.match(/^([^(]+)\s*\(/);
  if (paren) return paren[1].trim();
  return null;
}

const RAISE_ALIASES = [
  ["odysseus", /odysseus/i],
  ["skysails", /skysails/i],
  ["fishfrom", /fishfrom/i],
  ["panatere", /panatere/i],
  ["space solar", /space solar/i],
  ["casper", /casper funding/i],
  ["us arbitrage", /us arb/i],
  ["hooley", /hooley|nsip/i],
];

function guessCampaign(title, campaigns) {
  const t = title || "";
  const investor = campaigns.filter(
    (c) =>
      c.campaign_intent !== "customer" &&
      !/fischer farms/i.test(c.name) &&
      !/^AUDIT/i.test(c.name) &&
      !/wren aerospace/i.test(c.name),
  );
  for (const [, re] of RAISE_ALIASES) {
    if (!re.test(t)) continue;
    const hit = investor.find((c) => re.test(c.name) || /hooley/i.test(c.name) && /hooley|nsip/i.test(t));
    if (hit) return hit;
  }
  return null;
}

async function fetchPartnersFor(emails, names) {
  const rows = [];
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  for (let i = 0; i < uniqueEmails.length; i += 80) {
    const chunk = uniqueEmails.slice(i, i + 80);
    const { data, error } = await supabase
      .from("partners_mirror")
      .select("id, name, email, investors_mirror:investor_id ( firm_name )")
      .in("email", chunk);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  for (const name of [...new Set(names.filter(Boolean))]) {
    const { data, error } = await supabase
      .from("partners_mirror")
      .select("id, name, email, investors_mirror:investor_id ( firm_name )")
      .ilike("name", name)
      .limit(5);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

async function fetchCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent")
    .neq("status", "archived");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function mostRecentCp(partnerId, campaignId) {
  let q = supabase
    .from("campaign_partners")
    .select("id, status_code, campaign_id, campaigns:campaign_id ( name )")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

function matchPartner(partners, { email, name }) {
  if (email) {
    const hit = partners.find((p) => (p.email || "").toLowerCase() === email);
    if (hit) return hit;
  }
  if (name) {
    const n = name.toLowerCase().replace(/\s+/g, " ").trim();
    if (n.split(" ").length < 2) return null;
    const exact = partners.filter((p) => (p.name || "").toLowerCase() === n);
    if (exact.length === 1) return exact[0];
  }
  return null;
}

async function ingestMeetings(partners, campaigns) {
  const src = JSON.parse(
    readFileSync(resolve(ROOT, "data/calendar-week-source.json"), "utf8"),
  );
  const seenTitlesAt = new Set();
  const meetings = [];
  let inserted = 0;
  let dup = 0;

  for (const ev of src) {
    if (isNoiseMeeting(ev)) continue;
    const start = parseDate(ev.start_time);
    if (!start) continue;
    const dedupeKey = `${start}|${(ev.summary || "").trim()}`;
    if (seenTitlesAt.has(dedupeKey)) continue;
    seenTitlesAt.add(dedupeKey);

    const emails = (ev.attendee_emails || [])
      .map((e) => String(e).toLowerCase())
      .filter((e) => e && !SELF.has(e));
    let partner = null;
    for (const email of emails) {
      partner = matchPartner(partners, { email });
      if (partner) break;
    }
    if (!partner) {
      partner = matchPartner(partners, { name: guessNameFromTitle(ev.summary) });
    }
    const campaign = guessCampaign(ev.summary, campaigns);
    let cp = null;
    if (partner) {
      cp = await mostRecentCp(partner.id, campaign?.id ?? null);
      if (!cp) cp = await mostRecentCp(partner.id, null);
    }

    if (cp) {
      const { error } = await supabase.from("contact_events").insert({
        campaign_partner_id: cp.id,
        event_type: "meeting",
        event_at: start,
        direction: "meeting",
        channel: inferChannel(ev),
        title: ev.summary,
        summary: ev.summary,
        notes: ev.description || null,
        google_calendar_event_id: ev.event_id,
      });
      if (error && (error.code === "23505" || /duplicate/i.test(error.message))) {
        dup += 1;
      } else if (error) {
        console.error("meeting insert", ev.summary, error.message);
      } else {
        inserted += 1;
        await supabase
          .from("campaign_partners")
          .update({ last_contact_at: start })
          .eq("id", cp.id);
      }
    }

    meetings.push({
      id: `gcal:${ev.event_id}`,
      event_at: start,
      end_at: parseDate(ev.end_time),
      title: ev.summary,
      summary: ev.summary,
      partner_id: partner?.id ?? null,
      partner_name: partner?.name ?? guessNameFromTitle(ev.summary),
      firm_name: partner?.investors_mirror?.firm_name ?? null,
      campaign_name: campaign?.name ?? cp?.campaigns?.name ?? null,
      campaign_id: campaign?.id ?? cp?.campaign_id ?? null,
      status_code: cp?.status_code ?? null,
      unmatched: !partner,
      channel: inferChannel(ev),
      attendee_emails: emails,
    });
  }
  return { meetings, inserted, dup };
}

function isNoiseReply(row) {
  const from = (row.from || "").toLowerCase();
  const subject = (row.subject || "").toLowerCase();
  if (/saffery|tax return/.test(from + subject)) return true;
  if (/automatische antwort|automatic reply/.test(subject)) return true;
  if (/vacation|out of office/.test(subject)) return true;
  const at = parseDate(row.date);
  if (!at) return true;
  const age = Date.now() - new Date(at).getTime();
  if (age > 10 * 86400000) return true;
  return false;
}

async function ingestReplies(partners, campaigns) {
  const src = JSON.parse(
    readFileSync(resolve(ROOT, "data/inbox-week-source.json"), "utf8"),
  );
  const replies = [];
  let inserted = 0;
  let dup = 0;
  for (const row of src) {
    if (isNoiseReply(row)) continue;
    const email = parseEmail(row.from);
    if (!email || SELF.has(email)) continue;
    const partner = matchPartner(partners, {
      email,
      name: parseName(row.from),
    });
    const campaign = guessCampaign(row.subject, campaigns);
    let cp = null;
    if (partner) {
      cp = await mostRecentCp(partner.id, campaign?.id ?? null);
      if (!cp) cp = await mostRecentCp(partner.id, null);
    }
    const eventAt = parseDate(row.date);
    if (cp) {
      const { error } = await supabase.from("contact_events").insert({
        campaign_partner_id: cp.id,
        event_type: "reply",
        event_at: eventAt,
        direction: "inbound",
        channel: "gmail",
        summary: `${row.subject ?? ""} — ${(row.preview || "").slice(0, 160)}`.trim(),
        gmail_message_id: row.message_id,
        gmail_thread_id: row.thread_id,
      });
      if (error && (error.code === "23505" || /duplicate/i.test(error.message))) {
        dup += 1;
      } else if (error) {
        console.error("reply insert", row.subject, error.message);
      } else {
        inserted += 1;
        await supabase
          .from("campaign_partners")
          .update({ last_contact_at: eventAt })
          .eq("id", cp.id);
      }
    }
    replies.push({
      id: `gmail:${row.message_id}`,
      event_at: eventAt,
      summary: row.subject,
      preview: row.preview,
      from: row.from,
      partner_id: partner?.id ?? null,
      partner_name: partner?.name ?? parseName(row.from),
      firm_name: partner?.investors_mirror?.firm_name ?? null,
      campaign_name: campaign?.name ?? cp?.campaigns?.name ?? null,
      status_code: cp?.status_code ?? null,
      gmail_thread_id: row.thread_id,
      unmatched: !partner,
    });
  }
  return { replies, inserted, dup };
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("missing supabase env");
    process.exit(2);
  }
  const cal = JSON.parse(
    readFileSync(resolve(ROOT, "data/calendar-week-source.json"), "utf8"),
  );
  const inbox = JSON.parse(
    readFileSync(resolve(ROOT, "data/inbox-week-source.json"), "utf8"),
  );
  const emails = [];
  const names = [];
  for (const ev of cal) {
    for (const e of ev.attendee_emails || []) {
      const low = String(e).toLowerCase();
      if (!SELF.has(low)) emails.push(low);
    }
    const guessed = guessNameFromTitle(ev.summary);
    if (guessed) names.push(guessed);
  }
  for (const row of inbox) {
    const em = parseEmail(row.from);
    if (em && !SELF.has(em)) emails.push(em);
    const nm = parseName(row.from);
    if (nm) names.push(nm);
  }
  const [partners, campaigns] = await Promise.all([
    fetchPartnersFor(emails, names),
    fetchCampaigns(),
  ]);
  console.log("partners", partners.length, "campaigns", campaigns.length);
  const meetings = await ingestMeetings(partners, campaigns);
  const replies = await ingestReplies(partners, campaigns);
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    source: "google_mcp_ingest — gmail_tokens refresh revoked",
    meetings: meetings.meetings,
    replies: replies.replies,
  };
  writeFileSync(
    resolve(ROOT, "data/desk-week.json"),
    JSON.stringify(payload, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        meetings: meetings.meetings.length,
        meetings_inserted: meetings.inserted,
        meetings_dup: meetings.dup,
        replies: replies.replies.length,
        replies_inserted: replies.inserted,
        replies_dup: replies.dup,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
