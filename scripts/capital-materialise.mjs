#!/usr/bin/env node
/**
 * Turn tracker quarantine rows into firms / people / participations.
 * Never writes the 260817 spreadsheet.
 *
 * exact/alias → merge. no match → create (this one-time canonical import
 * is the explicit create decision). fuzzy → leave pending.
 *
 * Historical "approached" is stored as status_note + first_sent, not as
 * stage approached (that gate needs a verified named person).
 *
 * Dry-run default. --live writes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const CREATE_FUZZY = process.argv.includes("--create-fuzzy");

const BLOCKS = [
  { code: "SK", tick: 1, firstSent: 15, latest: 16, status: 18, commentary: 19 },
  { code: "FF", tick: 2, firstSent: 20, latest: 21, status: 23, commentary: 24 },
  { code: "PA", tick: 3, firstSent: 25, latest: 26, status: 28, commentary: 29 },
  { code: "SS", tick: 4, firstSent: 30, latest: 31, status: 33, commentary: 34 },
  { code: "CA", tick: 5, firstSent: 35, latest: 36, status: 38, commentary: 39 },
  { code: "US", tick: 6, firstSent: 40, latest: 41, status: 43, commentary: 44 },
  { code: "OD", tick: 7, firstSent: 45, latest: 46, status: 48, commentary: 49 },
  { code: "HO", tick: 8, firstSent: 50, latest: 51, status: 53, commentary: 54 },
];
const COL = { investor: 9, website: 10, contact: 11, email: 12, sector: 13 };

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

const url = process.env.FORGE_CAPITAL_DB_URL;
const key = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
if (!url || !key) {
  console.error("FORGE_CAPITAL_DB_* missing");
  process.exit(2);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const core = createClient(url, key, { ...opts, db: { schema: "core" } });
const engage = createClient(url, key, { ...opts, db: { schema: "engage" } });

function cell(row, i) {
  if (!row) return null;
  const v = row[i];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s === "Website" ? null : s;
}
function ticked(v) {
  if (v == null || v === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "✓" || s === "✔" || s === "x" || s === "yes" || s === "true" || s === "1";
}
function tidyName(name) {
  return String(name || "")
    .replace(/^\d+\s+/, "")
    .replace(/\s*\*+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
function domainOf(website) {
  if (!website) return null;
  let w = String(website).toLowerCase().trim();
  w = w.replace(/^https?:\/\//, "").replace(/^www\./, "");
  w = w.split("/")[0].split("?")[0].trim();
  if (!w || w === "website" || !w.includes(".")) return null;
  return w;
}
function isGenericInbox(email) {
  if (!email || !email.includes("@")) return true;
  const local = email.split("@")[0].toLowerCase();
  return /^(info|contact|team|hello|enquiries|enquiries|office|admin|support|general|ir|invest|partners)$/.test(
    local,
  );
}
function isGenericPerson(name) {
  const n = (name || "").toLowerCase();
  return /general enquir|enquiries|info@|team@|hello@|^info$|^contact$/.test(n);
}
function extractEmail(...parts) {
  const blob = parts.filter(Boolean).join(" ");
  const m = blob.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}
function extractPersonName(contact) {
  if (!contact) return null;
  let n = String(contact).replace(/\([^)]*@[^)]*\)/g, "").trim();
  n = n.replace(/\s+/g, " ");
  if (!n || isGenericPerson(n)) return null;
  return n;
}
function toIso(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString();
  if (typeof v === "number") {
    // Excel serial
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (Number.isFinite(d.getTime()) && d.getFullYear() > 1990) return d.toISOString();
  return null;
}
function mapStage(status, firmDnc) {
  if (firmDnc) return "blocked";
  const u = String(status || "").toUpperCase();
  if (/BLOCKED|DO NOT CONTACT|DNC/.test(u)) return "blocked";
  if (/DECLIN|\-1|CLOSED.?LOST|REJECT/.test(u)) return "closed_lost";
  if (/DISQUAL/.test(u)) return "disqualified";
  if (/COMMIT|CLOSED.?WON|\+9/.test(u)) return "committed";
  if (/DATAROOM/.test(u)) return "dataroom";
  if (/CALL BOOK|\+7|MEETING/.test(u)) return "meeting";
  if (/RESPOND|\+6|ENGAGED/.test(u)) return "responded";
  if (/\+1|APPROVED/.test(u)) return "approved";
  if (/\+0|PENDING APPROVAL|PERMISSION|AWAITING/.test(u)) return "awaiting_signoff";
  // Sent historically — do not use approached (gate needs verified email).
  if (/\+3|\+5|EMAIL SENT|SENT|FOLLOW-UP/.test(u)) return "approved";
  return "research";
}

async function loadAllQuarantine() {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await core
      .from("import_quarantine")
      .select("id, source, status, raw_payload")
      .eq("source", "tracker")
      .eq("status", "pending")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const { data: mandateRows, error: mErr } = await engage.from("mandates").select("id, code");
if (mErr) {
  console.error(mErr.message);
  process.exit(1);
}
const mandateId = Object.fromEntries((mandateRows ?? []).map((m) => [m.code, m.id]));

const pending = await loadAllQuarantine();
console.log("pending_tracker", pending.length, "live", LIVE);

const tally = {
  pending: pending.length,
  exact: 0,
  alias: 0,
  fuzzy: 0,
  none: 0,
  merged: 0,
  created: 0,
  people: 0,
  participations: 0,
  errors: 0,
  skipped_empty: 0,
};

const firmCache = new Map(); // tidyName lower -> {id, dnc, canonical_name}

async function matchBest(name) {
  const { data, error } = await core.rpc("match_firm", { p_name: name });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const best = rows
    .slice()
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))[0];
  return best ?? null;
}

async function ensureFirm(rawName, website, sector) {
  const canonical = tidyName(rawName);
  if (!canonical) return null;
  const key = canonical.toLowerCase();
  if (firmCache.has(key)) return firmCache.get(key);

  const hit = await matchBest(canonical);
  const kind = hit?.match_type ?? "none";
  if (kind === "exact" || kind === "alias") {
    tally[kind] += 1;
    const rec = { id: hit.firm_id, dnc: false, canonical_name: hit.canonical_name, match: kind };
    const { data: firm } = await core.from("firms").select("id, dnc, canonical_name").eq("id", hit.firm_id).maybeSingle();
    if (firm) {
      rec.dnc = firm.dnc;
      rec.canonical_name = firm.canonical_name;
    }
    firmCache.set(key, rec);
    return rec;
  }
  if (kind === "fuzzy" && !CREATE_FUZZY) {
    tally.fuzzy += 1;
    return { id: null, dnc: false, canonical_name: canonical, match: "fuzzy", hit };
  }
  if (kind === "fuzzy") tally.fuzzy += 1;
  else tally.none += 1;

  if (!LIVE) {
    const rec = { id: "dry-" + key, dnc: false, canonical_name: canonical, match: "create" };
    firmCache.set(key, rec);
    tally.created += 1;
    return rec;
  }
  const payload = {
    canonical_name: canonical,
    website_domain: domainOf(website),
    sectors: sector ? [sector] : null,
    created_from: "tracker",
  };
  let { data: created, error } = await core.from("firms").insert(payload).select("id, dnc, canonical_name").maybeSingle();
  if (error && /website_domain/i.test(error.message)) {
    payload.website_domain = null;
    const retry = await core.from("firms").insert(payload).select("id, dnc, canonical_name").maybeSingle();
    created = retry.data;
    error = retry.error;
  }
  if (error) {
    if (/unique|duplicate|norm_name/i.test(error.message)) {
      const { data: existing } = await core
        .from("firms")
        .select("id, dnc, canonical_name")
        .eq("canonical_name", canonical)
        .maybeSingle();
      if (existing) {
        tally.merged += 1;
        const rec = { id: existing.id, dnc: existing.dnc, canonical_name: existing.canonical_name, match: "unique-hit" };
        firmCache.set(key, rec);
        return rec;
      }
    }
    tally.errors += 1;
    console.error("firm insert", canonical, error.message);
    return null;
  }
  tally.created += 1;
  const rec = { id: created.id, dnc: created.dnc, canonical_name: created.canonical_name, match: "create" };
  firmCache.set(key, rec);
  return rec;
}

const seenPart = new Set();

for (const q of pending) {
  const payload = q.raw_payload || {};
  const row = payload.row;
  const firmName = payload.firm || cell(row, COL.investor);
  if (!firmName) {
    tally.skipped_empty += 1;
    continue;
  }
  let rec;
  try {
    rec = await ensureFirm(firmName, payload.website || cell(row, COL.website), payload.sector || cell(row, COL.sector));
  } catch (e) {
    tally.errors += 1;
    console.error("match", firmName, e.message);
    continue;
  }
  if (!rec) continue;

  if (rec.match === "fuzzy" && !CREATE_FUZZY) {
    if (LIVE) {
      await core
        .from("import_quarantine")
        .update({ suggested_match: rec.hit, status: "pending" })
        .eq("id", q.id);
    }
    continue;
  }

  const contact = payload.contact || cell(row, COL.contact);
  const email = extractEmail(payload.email, cell(row, COL.email), contact);
  const personName = extractPersonName(contact);
  let personId = null;
  if (personName && rec.id && !String(rec.id).startsWith("dry-")) {
    if (LIVE) {
      const personPayload = {
        firm_id: rec.id,
        full_name: personName,
        email: email && !isGenericInbox(email) ? email : null,
        email_state: email && !isGenericInbox(email) ? "unknown" : email ? "generic" : "unknown",
        provenance: "tracker",
      };
      const { data: person, error: pErr } = await core
        .from("people")
        .insert(personPayload)
        .select("id")
        .maybeSingle();
      if (pErr) {
        // Duplicate people are acceptable — find by name+firm
        const { data: existing } = await core
          .from("people")
          .select("id")
          .eq("firm_id", rec.id)
          .eq("full_name", personName)
          .maybeSingle();
        personId = existing?.id ?? null;
        if (!personId) {
          console.error("person", personName, pErr.message);
        }
      } else {
        personId = person?.id ?? null;
        tally.people += 1;
      }
    } else {
      tally.people += 1;
    }
  }

  for (const b of BLOCKS) {
    const tick = ticked(row?.[b.tick]);
    const status = cell(row, b.status);
    const commentary = cell(row, b.commentary);
    const firstSent = toIso(row?.[b.firstSent]);
    const latest = toIso(row?.[b.latest]);
    if (!tick && !status && !commentary && !firstSent && !latest) continue;
    const mid = mandateId[b.code];
    if (!mid) continue;
    const key = `${rec.id}|${mid}|${personId ?? "firm"}`;
    if (seenPart.has(key)) continue;
    seenPart.add(key);
    const stage = mapStage(status, rec.dnc);
    const note = [status, commentary].filter(Boolean).join(" — ").slice(0, 2000) || null;
    if (!LIVE || String(rec.id).startsWith("dry-")) {
      tally.participations += 1;
      continue;
    }
    const part = {
      person_id: personId,
      firm_id: rec.id,
      mandate_id: mid,
      stage,
      status_note: note,
      first_sent: firstSent,
      latest_touch: latest,
      created_by: "app",
    };
    const { error: partErr } = await engage.from("participations").insert(part);
    if (partErr) {
      if (!/unique|duplicate/i.test(partErr.message)) {
        console.error("participation", firmName, b.code, partErr.message);
        tally.errors += 1;
      }
    } else tally.participations += 1;
  }

  if (LIVE && rec.match !== "fuzzy") {
    const status = rec.match === "create" ? "created" : "merged";
    if (status === "merged") tally.merged += 1;
    await core
      .from("import_quarantine")
      .update({
        status,
        suggested_match: { firm_id: rec.id, match_type: rec.match, canonical_name: rec.canonical_name },
        decided_by: "app",
        decided_at: new Date().toISOString(),
      })
      .eq("id", q.id);
  }
}

const report = { at: new Date().toISOString(), live: LIVE, firms_in_cache: firmCache.size, ...tally };
console.log(report);
writeFileSync(resolve(ROOT, "data/capital-materialise-report.json"), JSON.stringify(report, null, 2));
if (tally.errors > 0) process.exit(1);
