#!/usr/bin/env node
/**
 * Quarantine ingest: never writes firms/people directly.
 * Sources: grok-handoff (current desk) then 260817 workbook.
 * Dry-run default. --live inserts into core.import_quarantine.
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
  process.argv.find((a) => a.endsWith(".xlsx")) ||
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
  console.error("FORGE_CAPITAL_DB_* missing — quarantine not run");
  process.exit(2);
}
const core = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

function cell(row, i) {
  return row[i] == null || row[i] === "" ? null : row[i];
}

const payloads = [];

if (existsSync(XLSX_PATH)) {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  console.log("workbook_sheets", wb.SheetNames);
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const start = name.toLowerCase().includes("master") ? 2 : 1;
    for (const row of rows.slice(start)) {
      if (!row || !row[0]) continue;
      payloads.push({
        source: "tracker",
        status: "pending",
        raw_payload: {
          tab: name,
          firm: cell(row, 0) ?? cell(row, 9),
          website: cell(row, 1) ?? cell(row, 10),
          contact: cell(row, 2) ?? cell(row, 11),
          email: cell(row, 3) ?? cell(row, 12),
          row,
        },
      });
    }
  }
} else {
  console.error("workbook missing", XLSX_PATH);
}

console.log("quarantine_candidates", payloads.length, "live", LIVE);

if (!LIVE) {
  console.log("dry_run_ok", { ingested: payloads.length, merged: 0, created: 0, pending: payloads.length, rejected: 0 });
  process.exit(0);
}

let ingested = 0;
let failed = 0;
for (let i = 0; i < payloads.length; i += 50) {
  const chunk = payloads.slice(i, i + 50);
  const { error } = await core.from("import_quarantine").insert(chunk);
  if (error) {
    failed += chunk.length;
    console.error("insert", i, error.message);
  } else ingested += chunk.length;
}

const report = {
  ingested,
  failed,
  pending: ingested,
  merged: 0,
  created: 0,
  rejected: 0,
  sum: ingested + failed,
  expected: payloads.length,
};
console.log(report);
if (report.sum !== payloads.length) {
  console.error("COUNT MISMATCH");
  process.exit(1);
}
writeFileSync(
  resolve(ROOT, "data/capital-quarantine-report.json"),
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
