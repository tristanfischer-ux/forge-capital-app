#!/usr/bin/env node
/**
 * Import Yuri RPM customer intelligence into Corpus as mandate YU.
 * Never writes the tracker xlsx. Dry-run default. --live writes.
 *
 *   node scripts/capital-import-yuri.mjs
 *   node scripts/capital-import-yuri.mjs --live
 *   node scripts/capital-import-yuri.mjs --live --skip-mail --skip-notes
 */
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIL_ONLY = process.argv.includes("--mail-only");
const LIVE = process.argv.includes("--live") || MAIL_ONLY;
const SKIP_MAIL = process.argv.includes("--skip-mail");
const SKIP_NOTES = process.argv.includes("--skip-notes");
const XLSX_PATH =
  "/Users/tristanfischer/Space Companies/Yuri/Yuri_RPM_Customer_Intelligence_Tracker.xlsx";
const MARIA_NOTES =
  "/Users/tristanfischer/Space Companies/Yuri/Yuri_Call_Notes_28Jul2026.md";

const YU_NARRATIVE = [
  "Customer intelligence — RPM voice-of-customer, not a fundraise.",
  "Do not pitch a raise to lab PIs.",
  "Approved subject: Yuri & the RPM — a short call?",
  "Always cc Maria Birlem, Christian Bruderrek, Daniel Kaschubek at yurigravity.com.",
  "Do not invent a microgravity link. HOLD if unverifiable.",
  "One university wanted to sue — keep off outreach until Maria flags it.",
  "Russia / export-control: DNC. NASA federal-employee ethics: do not cold-email .gov staff.",
].join(" ");

const PRINCIPALS = [
  { full_name: "Maria Birlem", email: "maria.birlem@yurigravity.com", role_title: "Founder" },
  {
    full_name: "Christian Bruderrek",
    email: "christian.bruderrek@yurigravity.com",
    role_title: "Founder",
  },
  {
    full_name: "Daniel Kaschubek",
    email: "daniel.kaschubek@yurigravity.com",
    role_title: "Founder",
  },
];

function loadEnv() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[line.slice(0, i).trim()] = v;
  }
}
loadEnv();

const url = process.env.FORGE_CAPITAL_DB_URL;
const key = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
if (!url || !key) {
  console.error("FORGE_CAPITAL_DB_* missing");
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const core = createClient(url, key, { ...opts, db: { schema: "core" } });
const engage = createClient(url, key, { ...opts, db: { schema: "engage" } });
const kg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const xlsxBefore = existsSync(XLSX_PATH) ? statSync(XLSX_PATH).mtimeMs : 0;
const tally = {
  firms_created: 0,
  firms_merged: 0,
  people: 0,
  participations: 0,
  dnc: 0,
  skipped: 0,
  errors: 0,
  mail_inserted: 0,
  mail_exists: 0,
  mail_unmatched: 0,
  notes_inserted: 0,
};

function cell(row, key) {
  const v = row?.[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function emailsFrom(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  const all = blob.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(all.map((e) => e.toLowerCase()))];
}

function isGenericInbox(email) {
  if (!email || !email.includes("@")) return true;
  const local = email.split("@")[0].toLowerCase();
  return /^(info|contact|team|hello|enquiries|office|admin|support|general)$/.test(local);
}

function isStudentId(email) {
  return /^\d+@/.test(email);
}

function pickEmail(emails, status, contact) {
  const mentioned = (status || "").match(
    /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/,
  );
  if (mentioned) {
    const m = mentioned[0].toLowerCase();
    if (!isStudentId(m)) return m;
  }
  const ranked = emails.filter((e) => !isStudentId(e) && !isGenericInbox(e));
  const surname = String(contact || "")
    .replace(/prof\.?|dr\.?/gi, "")
    .trim()
    .split(/[\s,]+/)
    .filter((w) => w.length > 2)
    .pop();
  if (surname) {
    const hit = ranked.find((e) => e.split("@")[0].toLowerCase().includes(surname.toLowerCase().slice(0, 6)));
    if (hit) return hit;
  }
  return ranked[0] ?? emails.filter((e) => !isStudentId(e))[0] ?? null;
}

function pickName(contact) {
  if (!contact) return null;
  let n = String(contact)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[A-Za-z0-9._%+\-]+@[^\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return null;
  if (/^[A-Za-zÀ-ÿ'\-]+,\s+[A-Za-zÀ-ÿ]/.test(n) && n.split(",").length === 2) {
    const [last, first] = n.split(",").map((s) => s.trim());
    if (first.split(/\s+/).length <= 3) return `${first} ${last}`.slice(0, 120);
  }
  const chunk = n.split(/[,/;]| and /)[0].trim();
  const words = chunk.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 6) return words.join(" ").slice(0, 120);
  return chunk.slice(0, 120);
}

function domainOfEmail(email) {
  if (!email || !email.includes("@")) return null;
  const d = email.split("@")[1].toLowerCase();
  if (["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"].includes(d)) {
    return null;
  }
  return d;
}

function mapStatus(status) {
  const s = (status || "").toLowerCase();
  const dnc =
    /do not contact|sent in error|sanctions|export-control|wanted to sue|not a researcher|ill \/ competitor|eu sanctions/.test(
      s,
    );
  let stage = "research";
  if (/nasa\/federal|federal-employee ethics/.test(s)) stage = "research";
  else if (/call done|call confirmed|visit confirmed/.test(s)) stage = "meeting";
  else if (/reply received|declined/.test(s)) stage = "responded";
  else if (/outreach sent|soft outreach|intro via|thank-you sent/.test(s)) stage = "approached";
  const bounced = /bounced/.test(s);
  let firstSent = null;
  const sent = (status || "").match(/SENT(?: IN ERROR)?\s+(\d{1,2})\s+(Aug|Jul|Sep|Jun)/i);
  if (sent) {
    const month = { jun: "06", jul: "07", aug: "08", sep: "09" }[sent[2].toLowerCase()];
    const day = String(sent[1]).padStart(2, "0");
    firstSent = `2026-${month}-${day}T12:00:00.000Z`;
  }
  const done = (status || "").match(/(?:DONE|CONFIRMED)\s+(\d{1,2})\s+(Aug|Jul|Sep)/i);
  let latest = firstSent;
  if (done) {
    const month = { jul: "07", aug: "08", sep: "09" }[done[2].toLowerCase()];
    const day = String(done[1]).padStart(2, "0");
    latest = `2026-${month}-${day}T12:00:00.000Z`;
  }
  return {
    stage,
    dnc,
    bounced,
    firstSent,
    latest,
    dncReason: dnc ? (status || "do not contact").slice(0, 240) : null,
  };
}

async function matchBest(name) {
  const { data, error } = await core.rpc("match_firm", { p_name: name });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.slice().sort((a, b) => Number(b.confidence) - Number(a.confidence))[0] ?? null;
}

async function ensureMandate() {
  const { data: existing } = await engage
    .from("mandates")
    .select("id, code")
    .eq("code", "YU")
    .maybeSingle();
  if (existing?.id) {
    if (LIVE) {
      await engage
        .from("mandates")
        .update({
          company_name: "Yuri",
          principal_name: "Maria Birlem",
          principal_email: "maria.birlem@yurigravity.com",
          ask_summary: "RPM customer intelligence (not a raise)",
          narrative_notes: YU_NARRATIVE,
          status: "active",
        })
        .eq("id", existing.id);
    }
    return existing.id;
  }
  if (!LIVE) return "dry-yu";
  const { data, error } = await engage
    .from("mandates")
    .insert({
      code: "YU",
      company_name: "Yuri",
      principal_name: "Maria Birlem",
      principal_email: "maria.birlem@yurigravity.com",
      ask_summary: "RPM customer intelligence (not a raise)",
      narrative_notes: YU_NARRATIVE,
      status: "active",
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`mandate insert: ${error.message}`);
  return data.id;
}

async function ensureYuriFirm() {
  const hit = await matchBest("yuri GmbH");
  if (hit?.firm_id && (hit.match_type === "exact" || hit.match_type === "alias")) {
    return hit.firm_id;
  }
  const { data: byDomain } = await core
    .from("firms")
    .select("id")
    .eq("website_domain", "yurigravity.com")
    .maybeSingle();
  if (byDomain?.id) return byDomain.id;
  if (!LIVE) return "dry-yuri";
  const { data, error } = await core
    .from("firms")
    .insert({
      canonical_name: "yuri GmbH",
      website_domain: "yurigravity.com",
      hq_country: "Germany",
      sectors: ["space-biotech", "RPM"],
      created_from: "yuri-tracker",
      notes: "Client. RPM (Random Positioning Machine) customer-intelligence programme. Meckenbeuren.",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    const { data: again } = await core
      .from("firms")
      .select("id")
      .eq("canonical_name", "yuri GmbH")
      .maybeSingle();
    if (again?.id) return again.id;
    throw new Error(`yuri firm: ${error.message}`);
  }
  return data.id;
}

async function ensurePerson(firmId, fullName, email, extra) {
  if (email) {
    const { data: byEmail } = await core
      .from("people")
      .select("id, firm_id")
      .ilike("email", email)
      .maybeSingle();
    if (byEmail?.id) return byEmail.id;
  }
  const { data: byName } = await core
    .from("people")
    .select("id")
    .eq("firm_id", firmId)
    .eq("full_name", fullName)
    .maybeSingle();
  if (byName?.id) return byName.id;
  if (!LIVE || String(firmId).startsWith("dry-")) return "dry-person";
  const payload = {
    firm_id: firmId,
    full_name: fullName,
    email: email && !isGenericInbox(email) ? email : null,
    email_state: extra?.email_state ?? (email && !isGenericInbox(email) ? "unknown" : "unknown"),
    provenance: "yuri-tracker",
    role_title: extra?.role_title ?? null,
    notes: extra?.notes ?? null,
    dnc: extra?.dnc ?? false,
    dnc_reason: extra?.dnc_reason ?? null,
  };
  const { data, error } = await core.from("people").insert(payload).select("id").maybeSingle();
  if (error) {
    if (!/unique|duplicate/i.test(error.message)) {
      console.error("person", fullName, error.message);
      tally.errors += 1;
    }
    const { data: existing } = await core
      .from("people")
      .select("id")
      .eq("firm_id", firmId)
      .eq("full_name", fullName)
      .maybeSingle();
    return existing?.id ?? null;
  }
  tally.people += 1;
  return data?.id ?? null;
}

async function ensureFirm(name, email, country, type, notes) {
  const canonical = name.replace(/\s+/g, " ").trim();
  const hit = await matchBest(canonical);
  const kind = hit?.match_type ?? "none";
  if ((kind === "exact" || kind === "alias") && hit.firm_id) {
    tally.firms_merged += 1;
    return hit.firm_id;
  }
  if (kind === "fuzzy" && Number(hit.confidence) >= 0.85 && hit.firm_id) {
    tally.firms_merged += 1;
    return hit.firm_id;
  }
  const domain = domainOfEmail(email);
  if (domain) {
    const { data: byDomain } = await core
      .from("firms")
      .select("id")
      .eq("website_domain", domain)
      .maybeSingle();
    if (byDomain?.id) {
      tally.firms_merged += 1;
      return byDomain.id;
    }
  }
  if (!LIVE) {
    tally.firms_created += 1;
    return "dry-" + canonical.toLowerCase();
  }
  const payload = {
    canonical_name: canonical,
    website_domain: domain,
    hq_country: country || null,
    sectors: type ? [String(type)] : ["RPM-customer"],
    created_from: "yuri-tracker",
    notes: notes || null,
  };
  let { data, error } = await core.from("firms").insert(payload).select("id").maybeSingle();
  if (error && /website_domain/i.test(error.message)) {
    payload.website_domain = null;
    const retry = await core.from("firms").insert(payload).select("id").maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (/unique|duplicate|norm_name/i.test(error.message)) {
      const { data: existing } = await core
        .from("firms")
        .select("id")
        .eq("canonical_name", canonical)
        .maybeSingle();
      if (existing?.id) {
        tally.firms_merged += 1;
        return existing.id;
      }
    }
    console.error("firm", canonical, error.message);
    tally.errors += 1;
    return null;
  }
  tally.firms_created += 1;
  return data.id;
}

async function ensureParticipation(firmId, personId, mandateId, mapped, statusNote, nextAction) {
  if (!LIVE || String(firmId).startsWith("dry-")) {
    tally.participations += 1;
    return;
  }
  const part = {
    person_id: personId,
    firm_id: firmId,
    mandate_id: mandateId,
    stage: mapped.stage,
    status_note: statusNote,
    next_action: nextAction,
    first_sent: mapped.firstSent,
    latest_touch: mapped.latest,
    created_by: "app",
  };
  const { error } = await engage.from("participations").insert(part);
  if (error) {
    if (/unique|duplicate/i.test(error.message)) {
      await engage
        .from("participations")
        .update({
          stage: mapped.stage,
          status_note: statusNote,
          next_action: nextAction,
          first_sent: mapped.firstSent,
          latest_touch: mapped.latest,
        })
        .eq("firm_id", firmId)
        .eq("mandate_id", mandateId)
        .eq("person_id", personId);
      return;
    }
    console.error("participation", firmId, error.message);
    tally.errors += 1;
    return;
  }
  tally.participations += 1;
}

async function appendNote(table, id, block) {
  if (!LIVE || !id || String(id).startsWith("dry-")) return;
  const { data } = await core.from(table).select("notes").eq("id", id).maybeSingle();
  const stamp = new Date().toISOString().slice(0, 10);
  const chunk = `\n\n[${stamp}]\n${block}`.trim();
  const prev = (data?.notes ?? "").trim();
  const next = (prev ? `${prev}${chunk}` : chunk).slice(-8000);
  await core.from(table).update({ notes: next }).eq("id", id);
}

async function logActivity(opts) {
  if (!LIVE) return "dry";
  const { data: existing } = await engage
    .from("activities")
    .select("id")
    .eq("source_id", opts.sourceId)
    .maybeSingle();
  if (existing?.id) return "exists";
  const { data, error } = await engage
    .from("activities")
    .insert({
      occurred_at: opts.occurredAt,
      channel: opts.channel,
      subject: (opts.subject ?? "").slice(0, 500),
      snippet: (opts.snippet ?? "").slice(0, 500),
      source_id: opts.sourceId,
      match_confidence: opts.personId || opts.firmId ? 0.9 : 0.3,
      created_by: "app",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (/unique|duplicate/i.test(error.message)) return "exists";
    throw new Error(error.message);
  }
  const links = [];
  if (opts.personId) {
    links.push({
      activity_id: data.id,
      entity_type: "person",
      entity_id: opts.personId,
      link_source: "app",
    });
  }
  if (opts.firmId) {
    links.push({
      activity_id: data.id,
      entity_type: "firm",
      entity_id: opts.firmId,
      link_source: "app",
    });
  }
  if (links.length) await engage.from("activity_links").insert(links);
  if ((opts.channel === "email_out" || opts.channel === "email_in") && opts.personId) {
    await engage
      .from("participations")
      .update({ latest_touch: opts.occurredAt })
      .eq("person_id", opts.personId);
  }
  return "inserted";
}

async function refreshGoogle(refreshToken) {
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
    if (!res.ok) throw new Error(`gmail list ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const m of json.messages ?? []) ids.push(m.id);
    page = json.nextPageToken;
    if (ids.length >= 400) break;
  } while (page);
  return ids;
}

async function gmailGet(token, id, format) {
  const params = new URLSearchParams({ format });
  if (format === "metadata") {
    for (const h of ["From", "To", "Cc", "Subject", "Date"]) params.append("metadataHeaders", h);
  }
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`gmail get ${res.status}`);
  return res.json();
}

function headerOf(headers, name) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodePart(data) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripTags(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function loadPeopleByEmail() {
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

async function ingestMail(access) {
  const people = await loadPeopleByEmail();
  const q =
    '(subject:"Yuri & the RPM" OR "Thank you — Yuri" OR to:yurigravity.com OR from:yurigravity.com) after:2026/07/01 -from:gemini-notes@google.com -in:chat';
  const ids = await gmailList(access, q);
  console.log("yuri_mail_listed", ids.length);
  for (const id of ids) {
    let meta;
    try {
      meta = await gmailGet(access, id, "metadata");
    } catch {
      continue;
    }
    const headers = meta.payload?.headers ?? [];
    const from = headerOf(headers, "From").toLowerCase();
    const to = `${headerOf(headers, "To")} ${headerOf(headers, "Cc")}`.toLowerCase();
    const subject = headerOf(headers, "Subject");
    const labels = meta.labelIds ?? [];
    const channel = labels.includes("SENT") || from.includes("tristan.fischer@gmail.com")
      ? "email_out"
      : "email_in";
    const occurred = meta.internalDate
      ? new Date(Number(meta.internalDate)).toISOString()
      : new Date().toISOString();
    const blob = `${from} ${to}`;
    const emails = emailsFrom(blob).filter(
      (e) => e !== "tristan.fischer@gmail.com" && !e.endsWith("@yurigravity.com"),
    );
    let person = null;
    for (const e of emails) {
      if (people.has(e)) {
        person = people.get(e);
        break;
      }
    }
    if (!person) {
      tally.mail_unmatched += 1;
      continue;
    }
    const result = await logActivity({
      sourceId: `gmail:${id}`,
      occurredAt: occurred,
      channel,
      subject,
      snippet: subject,
      personId: person.id,
      firmId: person.firm_id,
    });
    if (result === "inserted") tally.mail_inserted += 1;
    else if (result === "exists") tally.mail_exists += 1;
  }
}

const GEMINI_HINTS = [
  { re: /marcelo/i, email: "marcelo.vazquez@cnl.ca" },
  { re: /jamie foster/i, email: "jfoster@ufl.edu" },
  { re: /sara eyal/i, email: "sarae@ekmd.huji.ac.il" },
  { re: /bailey mendel/i, email: null },
  { re: /szentesi/i, email: "szentesi.peter@med.unideb.hu" },
  { re: /fuso/i, email: "andrea.fuso@uniroma1.it" },
];

async function ingestGemini(access, peopleByEmail) {
  const q =
    'from:gemini-notes@google.com (Yuri OR RPM OR Marcelo OR "Jamie Foster" OR Szentesi OR Fuso OR "Bailey Mendel" OR "Sara Eyal")';
  const ids = await gmailList(access, q);
  console.log("yuri_gemini_listed", ids.length);
  for (const id of ids) {
    let msg;
    try {
      msg = await gmailGet(access, id, "full");
    } catch {
      continue;
    }
    const headers = msg.payload?.headers ?? [];
    const subject = headerOf(headers, "Subject");
    const html =
      decodePart(msg.payload?.body?.data) ||
      decodePart(msg.payload?.parts?.find((p) => p.mimeType === "text/html")?.body?.data) ||
      decodePart(msg.payload?.parts?.find((p) => p.mimeType === "text/plain")?.body?.data);
    const blob = stripTags(html);
    if (blob.length < 40) continue;
    const occurred = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString();
    let person = null;
    for (const hint of GEMINI_HINTS) {
      if (hint.re.test(subject) && hint.email && peopleByEmail.has(hint.email)) {
        person = peopleByEmail.get(hint.email);
        break;
      }
    }
    if (!person) {
      const counterpart = subject.match(/Notes:\s*'([^']+?)\s+and\s+Tristan/i)?.[1];
      if (counterpart) {
        const want = counterpart.toLowerCase();
        for (const p of peopleByEmail.values()) {
          const n = (p.full_name || "").toLowerCase();
          if (n && want.includes(n.split(/\s+/).filter((w) => w.length > 2).pop() || "___") && n.split(/\s+/).length >= 2) {
            if (want.includes(n.split(/\s+/)[0].replace(/^prof\.?|^dr\.?/, ""))) {
              person = p;
              break;
            }
          }
        }
      }
    }
    const result = await logActivity({
      sourceId: `gmail-gemini:${id}`,
      occurredAt: occurred,
      channel: "note",
      subject,
      snippet: blob.slice(0, 500),
      personId: person?.id ?? null,
      firmId: person?.firm_id ?? null,
    });
    if (result === "inserted") {
      tally.notes_inserted += 1;
      if (person?.id) await appendNote("people", person.id, `Gemini: ${subject}\n${blob.slice(0, 2500)}`);
      if (person?.firm_id) await appendNote("firms", person.firm_id, `Gemini: ${subject}\n${blob.slice(0, 1500)}`);
    }
  }
}

async function ingestMariaNotes(yuriFirmId) {
  if (!existsSync(MARIA_NOTES)) return;
  const text = readFileSync(MARIA_NOTES, "utf8");
  const result = await logActivity({
    sourceId: "file:Yuri_Call_Notes_28Jul2026.md",
    occurredAt: "2026-07-28T12:00:00.000Z",
    channel: "note",
    subject: "Yuri call — Maria and team, 28 Jul 2026",
    snippet: text.slice(0, 500),
    firmId: yuriFirmId,
  });
  if (result === "inserted") {
    tally.notes_inserted += 1;
    await appendNote("firms", yuriFirmId, text.slice(0, 4000));
  }
}

// ---------- run ----------
if (!MAIL_ONLY && !existsSync(XLSX_PATH)) {
  console.error("tracker missing", XLSX_PATH);
  process.exit(2);
}

if (MAIL_ONLY) {
  const { data: tokens, error } = await kg.from("gmail_tokens").select("*").limit(1);
  if (error) throw new Error(error.message);
  const row = tokens?.[0];
  if (!row?.refresh_token) {
    console.error("no gmail token");
    process.exit(2);
  }
  const refreshed = await refreshGoogle(row.refresh_token);
  await ingestMail(refreshed.access_token);
  const report = { at: new Date().toISOString(), live: LIVE, mail_only: true, ...tally };
  console.log(report);
  writeFileSync(resolve(ROOT, "data/capital-import-yuri-report.json"), JSON.stringify(report, null, 2));
  process.exit(0);
}

const mandateId = await ensureMandate();
const yuriFirmId = await ensureYuriFirm();
for (const p of PRINCIPALS) {
  const id = await ensurePerson(yuriFirmId, p.full_name, p.email, { role_title: p.role_title });
  console.log("principal", p.full_name, LIVE ? id : "dry");
}

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const accounts = XLSX.utils.sheet_to_json(wb.Sheets["Accounts"], { defval: null });
console.log("tracker_rows", accounts.length, "live", LIVE);

for (const row of accounts) {
  const org = cell(row, "Organisation");
  if (!org) {
    tally.skipped += 1;
    continue;
  }
  const status = cell(row, "Status") || "";
  const notes = [
    cell(row, "Notes"),
    cell(row, "What it is"),
    cell(row, "How they use the RPM"),
    cell(row, "Yuri's relationship note"),
    cell(row, "Deep profile (research agent)"),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
  const mapped = mapStatus(status);
  const emails = emailsFrom(cell(row, "Email"), cell(row, "Contact"), status, cell(row, "Notes"));
  const email = pickEmail(emails, status, cell(row, "Contact"));
  const name = pickName(cell(row, "Contact")) || (email ? email.split("@")[0] : org);
  try {
    const firmId = await ensureFirm(
      org,
      email,
      cell(row, "Country"),
      cell(row, "Type"),
      notes,
    );
    if (!firmId) continue;
    if (mapped.dnc && LIVE && !String(firmId).startsWith("dry-")) {
      await core
        .from("firms")
        .update({ dnc: true, dnc_reason: mapped.dncReason, dnc_set_at: new Date().toISOString() })
        .eq("id", firmId);
      tally.dnc += 1;
    }
    const personId = await ensurePerson(firmId, name, email, {
      notes,
      dnc: mapped.dnc,
      dnc_reason: mapped.dncReason,
      email_state: mapped.bounced ? "bounced" : email ? "unknown" : "unknown",
    });
    const statusNote = [`[${mapped.stage}]`, status, cell(row, "Next action")]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 2000);
    // Rule 13: approached/meeting needs a NeverBounce-verified named person.
    // Historical tracker rows land at research; the real stage lives in status_note.
    const stored = { ...mapped, stage: "research" };
    await ensureParticipation(
      firmId,
      personId && !String(personId).startsWith("dry-") ? personId : null,
      mandateId,
      stored,
      statusNote || null,
      cell(row, "Next action"),
    );
  } catch (err) {
    tally.errors += 1;
    console.error("row", org, err.message);
  }
}

if (LIVE && !SKIP_MAIL) {
  const { data: tokens, error } = await kg.from("gmail_tokens").select("*").limit(1);
  if (error) throw new Error(error.message);
  const row = tokens?.[0];
  if (!row?.refresh_token) {
    console.error("no gmail token — skip mail/notes");
  } else {
    const refreshed = await refreshGoogle(row.refresh_token);
    await ingestMail(refreshed.access_token);
    if (!SKIP_NOTES) {
      const people = await loadPeopleByEmail();
      await ingestGemini(refreshed.access_token, people);
    }
  }
}
if (LIVE && !SKIP_NOTES) {
  await ingestMariaNotes(yuriFirmId);
}

const xlsxAfter = statSync(XLSX_PATH).mtimeMs;
const report = {
  at: new Date().toISOString(),
  live: LIVE,
  xlsx_untouched: xlsxBefore === xlsxAfter,
  xlsx_mtime: new Date(xlsxAfter).toISOString(),
  ...tally,
};
console.log(report);
writeFileSync(resolve(ROOT, "data/capital-import-yuri-report.json"), JSON.stringify(report, null, 2));
if (xlsxBefore !== xlsxAfter) {
  console.error("REFUSAL: tracker xlsx mtime changed — abort");
  process.exit(2);
}
if (tally.errors > 0) process.exit(1);
