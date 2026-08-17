#!/usr/bin/env node
/**
 * Import 260812 Master Tracker into campaign_partners + review queue.
 * Dry-run by default. Pass --live to write.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}
loadEnv();

const LIVE = process.argv.includes("--live");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx")) ||
  "/Users/tristanfischer/Developer/Forge-Capital/260812 Master Investor Tracker TF (CANONICAL).xlsx";

const RAISES = [
  { key: "SkySails", campaignName: "SkySails Power", tick: 1, status: 18, commentary: 19, first: 15, latest: 16 },
  { key: "FishFrom", campaignName: "FishFrom Technologies", tick: 2, status: 23, commentary: 24, first: 20, latest: 21 },
  { key: "Panatere", campaignName: "Panatere", tick: 3, status: 28, commentary: 29, first: 25, latest: 26 },
  { key: "Space Solar", campaignName: "Space Solar", tick: 4, status: 33, commentary: 34, first: 30, latest: 31 },
  { key: "Casper", campaignName: "Casper Funding", tick: 5, status: 38, commentary: 39, first: 35, latest: 36 },
  { key: "US Arb", campaignName: "US Arbitrage", tick: 6, status: 43, commentary: 44, first: 40, latest: 41 },
  { key: "Odysseus", campaignName: "Odysseus Space", tick: 7, status: 48, commentary: 49, first: 45, latest: 46 },
  { key: "Hooley", campaignName: "Hooley RF", tick: 8, status: 53, commentary: 54, first: 50, latest: 51 },
];

const CODES = new Set([
  "+12", "+11", "+10", "+9", "+8", "+7", "+6.5", "+6", "+5", "+4", "+3", "+2", "+1", "+0",
  "-1", "-2", "-3",
]);

function mapStatus(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { statusCode: null, permission: "not_required", needsReview: false };
  }
  const text = String(raw).trim();
  if (/permission requested/i.test(text) || /us candidate/i.test(text)) {
    const m = text.match(/^([+\-]\d+(?:\.\d+)?)/);
    const code = m && CODES.has(m[1]) ? m[1] : "+0";
    return { statusCode: code, permission: "pending_approval", needsReview: false };
  }
  if (/draft held/i.test(text) || /awaiting company approval/i.test(text)) {
    return { statusCode: "+1", permission: "pending_approval", needsReview: false };
  }
  if (/^rejected/i.test(text)) {
    return { statusCode: "-1", permission: "not_required", needsReview: false };
  }
  if (/ongoing discussions/i.test(text) || /^no answer/i.test(text) || /no meeting yet/i.test(text)) {
    return { statusCode: null, permission: "not_required", needsReview: true };
  }
  const m = text.match(/^([+\-]\d+(?:\.\d+)?)/);
  if (m && CODES.has(m[1])) {
    return { statusCode: m[1], permission: "not_required", needsReview: false };
  }
  return { statusCode: null, permission: "not_required", needsReview: true };
}

function excelDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const utc = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(utc.getTime()) ? null : utc.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cell(row, idx) {
  return row[idx] == null || row[idx] === "" ? null : row[idx];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const batch = `import-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
const QUEUE_FILE = resolve(ROOT, "data/import-review-queue.json");

async function hasColumn(table, col) {
  const { error } = await supabase.from(table).select(col).limit(1);
  return !error;
}
const HAS_STATUS_RAW = await hasColumn("campaign_partners", "status_raw");
const HAS_QUEUE_TABLE = await hasColumn("import_review_queue", "id");
const HAS_POLICY = await hasColumn("contact_policy", "id");
console.log("schema", { HAS_STATUS_RAW, HAS_QUEUE_TABLE, HAS_POLICY });

function appendQueueFile(item) {
  let arr = [];
  if (existsSync(QUEUE_FILE)) {
    try { arr = JSON.parse(readFileSync(QUEUE_FILE, "utf8")); } catch { arr = []; }
  }
  arr.push(item);
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(arr, null, 2));
}

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const sheet = wb.Sheets["Master Tracker"] || wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
// row 0 group, row 1 headers, data from 2
const dataRows = rows.slice(2);

console.log("file", XLSX_PATH);
console.log("data_rows", dataRows.length, "live", LIVE, "batch", batch);

const campaignNames = [...new Set(RAISES.map((r) => r.campaignName))];
const { data: existingCamps } = await supabase.from("campaigns").select("id, name");
const campByName = new Map((existingCamps ?? []).map((c) => [c.name, c.id]));

for (const name of campaignNames) {
  if (campByName.has(name)) continue;
  if (!LIVE) {
    console.log("would_create_campaign", name);
    campByName.set(name, `dry-${name}`);
    continue;
  }
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      name,
      campaign_intent: "investor",
      status: "active",
      company_description: `${name} raise imported from master tracker ${batch}`,
    })
    .select("id, name")
    .single();
  if (error) {
    console.error("create campaign", name, error.message);
    process.exit(1);
  }
  campByName.set(name, data.id);
  console.log("created_campaign", name, data.id);
}

const emailToPartners = new Map();
{
  const emails = new Set();
  for (const row of dataRows) {
    const emailRaw = cell(row, 12) ? String(row[12]).trim() : null;
    if (emailRaw && emailRaw.includes("@")) emails.add(emailRaw.toLowerCase());
  }
  const list = [...emails];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const { data: hits, error } = await supabase
      .from("partners_mirror")
      .select("id, investor_id, email")
      .in("email", chunk);
    if (error) {
      console.error("email lookup", error.message);
      break;
    }
    for (const h of hits ?? []) {
      const k = String(h.email).toLowerCase();
      if (!emailToPartners.has(k)) emailToPartners.set(k, []);
      emailToPartners.get(k).push(h);
    }
  }
  console.log("email_index", emailToPartners.size, "of", list.length);
}

let ticked = 0;
let matched = 0;
let queued = 0;
let applied = 0;
let policies = 0;

for (const row of dataRows) {
  if (!row || !row[9]) continue;
  const firm = String(row[9]).trim();
  const website = cell(row, 10) ? String(row[10]).trim() : null;
  const contact = cell(row, 11) ? String(row[11]).trim() : null;
  const emailRaw = cell(row, 12) ? String(row[12]).trim() : null;
  const email = emailRaw && emailRaw.includes("@") ? emailRaw.toLowerCase() : null;
  const jordanRule = cell(row, 59) ? String(row[59]).trim() : null;

  for (const raise of RAISES) {
    const tick = cell(row, raise.tick);
    const statusRaw = cell(row, raise.status);
    if (!tick && !statusRaw) continue;
    ticked += 1;
    if (ticked > LIMIT) break;

    const mapped = mapStatus(statusRaw ? String(statusRaw) : null);
    const last = excelDate(cell(row, raise.latest)) || excelDate(cell(row, raise.first));
    const commentary = cell(row, raise.commentary) ? String(row[raise.commentary]) : null;
    const campaignId = campByName.get(raise.campaignName);

    let partnerId = null;
    let reason = null;
    if (email) {
      const hits = emailToPartners.get(email) ?? [];
      if (hits.length === 1) partnerId = hits[0].id;
      else if (hits.length > 1) reason = "email_ambiguous";
      else reason = "email_unmatched";
    } else {
      reason = "no_email";
    }

    if (!partnerId) {
      queued += 1;
      if (LIVE) {
        const item = {
          import_batch: batch,
          campaign_name: raise.campaignName,
          firm_name: firm,
          contact_name: contact,
          email,
          website,
          status_raw: statusRaw ? String(statusRaw) : null,
          commentary,
          last_contact_at: last,
          reason: reason ?? "unmatched",
          disposition: "unresolved",
        };
        if (HAS_QUEUE_TABLE) await supabase.from("import_review_queue").insert(item);
        else appendQueueFile(item);
      }
      continue;
    }

    matched += 1;
    if (!LIVE) continue;

    const { data: existing } = await supabase
      .from("campaign_partners")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("partner_id", partnerId)
      .maybeSingle();

    const payload = {
      campaign_id: campaignId,
      partner_id: partnerId,
      status_code: mapped.statusCode,
      status_label: mapped.statusCode,
      permission_status: mapped.permission,
      last_contact_at: last,
    };
    if (HAS_STATUS_RAW) {
      payload.status_raw = statusRaw ? String(statusRaw) : null;
      payload.import_needs_review = mapped.needsReview;
      payload.import_batch = batch;
    }

    let cpId = existing?.id ?? null;
    if (existing?.id) {
      await supabase.from("campaign_partners").update(payload).eq("id", existing.id);
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("campaign_partners")
        .insert(payload)
        .select("id")
        .single();
      if (insErr) {
        console.error("insert cp", firm, raise.campaignName, insErr.message);
        continue;
      }
      cpId = inserted.id;
    }
    applied += 1;

    if (commentary && !existing?.id && cpId) {
      await supabase.from("contact_events").insert({
        campaign_partner_id: cpId,
        direction: "manual",
        channel: "manual",
        event_type: "import_note",
        event_at: last || new Date().toISOString(),
        summary: commentary.slice(0, 2000),
      });
    }

    if (raise.key === "Odysseus" && jordanRule === "DO_NOT_OUTREACH" && HAS_POLICY) {
      const { data: already } = await supabase
        .from("contact_policy")
        .select("id")
        .eq("partner_id", partnerId)
        .eq("kind", "block")
        .eq("source", "jordan_odysseus")
        .maybeSingle();
      if (!already) {
        await supabase.from("contact_policy").insert({
          partner_id: partnerId,
          channel: "any",
          kind: "block",
          source: "jordan_odysseus",
          reason: "Jordan DO_NOT_OUTREACH",
        });
        policies += 1;
      }
    }
  }
  if (ticked > LIMIT) break;
}

console.log(JSON.stringify({ batch, ticked, matched, queued, applied, policies, live: LIVE }, null, 2));
if (!LIVE) console.log("dry-run only. re-run with --live to write.");
