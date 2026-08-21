#!/usr/bin/env node
/**
 * Link LinkedIn Connections into the shared book. Match firms via
 * match_firm; create a person with linkedin_url. Unmatched firms are
 * created with created_from=linkedin so the connection is not dropped.
 * Never writes the 260817 spreadsheet.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const XLSX_PATH =
  "/Users/tristanfischer/Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx";

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
const core = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

const wb = XLSX.readFile(XLSX_PATH);
const sh = wb.Sheets["LinkedIn Connections"];
const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
const data = rows.slice(1).filter((r) => r && r[0]);
console.log("linkedin_rows", data.length, "live", LIVE);

const tally = { matched: 0, created_firm: 0, people: 0, skipped: 0, errors: 0 };
const firmCache = new Map();

async function firmFor(name) {
  const canonical = String(name || "").replace(/^\d+\s+/, "").trim();
  if (!canonical) return null;
  const keyName = canonical.toLowerCase();
  if (firmCache.has(keyName)) return firmCache.get(keyName);
  const { data: hit } = await core.rpc("match_firm", { p_name: canonical });
  const rowsHit = Array.isArray(hit) ? hit : hit ? [hit] : [];
  const best = rowsHit
    .slice()
    .sort((a, b) => Number(b.confidence) - Number(a.confidence))
    .find((r) => r.match_type === "exact" || r.match_type === "alias");
  if (best?.firm_id) {
    tally.matched += 1;
    firmCache.set(keyName, best.firm_id);
    return best.firm_id;
  }
  if (!LIVE) {
    tally.created_firm += 1;
    firmCache.set(keyName, "dry");
    return "dry";
  }
  const { data: created, error } = await core
    .from("firms")
    .insert({ canonical_name: canonical, created_from: "linkedin" })
    .select("id")
    .maybeSingle();
  if (error) {
    const { data: existing } = await core
      .from("firms")
      .select("id")
      .eq("canonical_name", canonical)
      .maybeSingle();
    if (existing?.id) {
      firmCache.set(keyName, existing.id);
      return existing.id;
    }
    tally.errors += 1;
    console.error("firm", canonical, error.message);
    return null;
  }
  tally.created_firm += 1;
  firmCache.set(keyName, created.id);
  return created.id;
}

for (const row of data) {
  const name = String(row[0] || "").trim();
  const firmName = String(row[1] || "").trim();
  const title = row[2] ? String(row[2]).trim() : null;
  const li = row[3] ? String(row[3]).trim() : null;
  const email = row[5] ? String(row[5]).trim().toLowerCase() : null;
  if (!name || !firmName) {
    tally.skipped += 1;
    continue;
  }
  const firmId = await firmFor(firmName);
  if (!firmId || firmId === "dry") {
    if (firmId === "dry") tally.people += 1;
    continue;
  }
  if (!LIVE) {
    tally.people += 1;
    continue;
  }
  const { data: existing } = await core
    .from("people")
    .select("id, linkedin_url, email")
    .eq("firm_id", firmId)
    .eq("full_name", name)
    .maybeSingle();
  if (existing?.id) {
    const patch = {};
    if (li && !existing.linkedin_url) patch.linkedin_url = li;
    if (email && !existing.email) patch.email = email;
    if (Object.keys(patch).length) {
      await core.from("people").update(patch).eq("id", existing.id);
    }
    tally.people += 1;
    continue;
  }
  const { error } = await core.from("people").insert({
    firm_id: firmId,
    full_name: name,
    role_title: title,
    email,
    email_state: email ? "unknown" : "unknown",
    linkedin_url: li,
    provenance: "linkedin",
  });
  if (error) {
    tally.errors += 1;
    console.error("person", name, error.message);
  } else tally.people += 1;
}

const report = { live: LIVE, rows: data.length, ...tally };
console.log(report);
writeFileSync(
  resolve(ROOT, "data/capital-linkedin-report.json"),
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
if (tally.errors > 50) process.exit(1);
