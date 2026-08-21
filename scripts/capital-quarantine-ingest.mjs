#!/usr/bin/env node
/**
 * Quarantine ingest: never writes firms/people directly.
 * Master Tracker layout is the opened 260817 workbook (investor = col 10).
 * Dry-run default. --live inserts into core.import_quarantine.
 * Verify counts after every batch. Do not skip empty column A.
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

const EXPECTED_DATA_ROWS = 2844;
const HEADER_ROWS = 2;
const COL = {
  investor: 9,
  website: 10,
  contact: 11,
  email: 12,
  sector: 13,
};

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

function cell(row, i) {
  const v = row[i];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseMaster(wb) {
  const sheet = wb.Sheets["Master Tracker"];
  if (!sheet) {
    throw new Error("Master Tracker sheet missing");
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const sheetRows = rows.length;
  const data = rows.slice(HEADER_ROWS);
  const payloads = [];
  let missingName = 0;
  const names = new Set();
  for (const row of data) {
    if (!row || !row.some((c) => c != null && String(c).trim() !== "")) continue;
    const firm = cell(row, COL.investor);
    if (!firm) {
      missingName += 1;
      continue;
    }
    names.add(firm);
    payloads.push({
      source: "tracker",
      status: "pending",
      raw_payload: {
        tab: "Master Tracker",
        firm,
        website: cell(row, COL.website),
        contact: cell(row, COL.contact),
        email: cell(row, COL.email),
        sector: cell(row, COL.sector),
        row,
      },
    });
  }
  return {
    sheetRows,
    dataRows: data.length,
    payloads,
    missingName,
    uniqueNames: names.size,
  };
}

function parseLinkedIn(wb) {
  const sheet = wb.Sheets["LinkedIn Connections"];
  if (!sheet) return { payloads: [], rows: 0 };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const data = rows.slice(1);
  const payloads = [];
  for (const row of data) {
    if (!row || !row[0]) continue;
    payloads.push({
      source: "linkedin",
      status: "pending",
      raw_payload: {
        tab: "LinkedIn Connections",
        firm: cell(row, 0),
        contact: cell(row, 1) ?? cell(row, 2),
        email: null,
        row,
        note: "link to core only — never bulk-create from LinkedIn",
      },
    });
  }
  return { payloads, rows: data.length };
}

if (!existsSync(XLSX_PATH)) {
  console.error("workbook missing", XLSX_PATH);
  process.exit(2);
}

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const master = parseMaster(wb);
const linkedin = parseLinkedIn(wb);

console.log({
  workbook: XLSX_PATH,
  sheets: wb.SheetNames,
  master_sheet_rows: master.sheetRows,
  master_data_rows: master.dataRows,
  expected_data_rows: EXPECTED_DATA_ROWS,
  tracker_payloads: master.payloads.length,
  unique_investor_names: master.uniqueNames,
  missing_investor_name: master.missingName,
  linkedin_rows: linkedin.rows,
  linkedin_payloads: linkedin.payloads.length,
  live: LIVE,
});

if (master.dataRows !== EXPECTED_DATA_ROWS) {
  console.error("COUNT MISMATCH vs opened 260817 artefact", {
    got: master.dataRows,
    expected: EXPECTED_DATA_ROWS,
  });
  process.exit(1);
}
if (master.payloads.length !== master.dataRows) {
  console.error("payload count != data rows", master.payloads.length, master.dataRows);
  process.exit(1);
}

const trackerPayloads = master.payloads;
// LinkedIn is quarantined as link-candidates, not firm creates.
const all = trackerPayloads;

if (!LIVE) {
  const report = {
    ingested: 0,
    failed: 0,
    pending: all.length,
    merged: 0,
    created: 0,
    rejected: 0,
    sum: all.length,
    expected: EXPECTED_DATA_ROWS,
    unique_names: master.uniqueNames,
    dry_run: true,
  };
  console.log("dry_run_ok", report);
  writeFileSync(
    resolve(ROOT, "data/capital-quarantine-report.json"),
    JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
  );
  process.exit(0);
}

const url = process.env.FORGE_CAPITAL_DB_URL;
const key = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
if (!url || !key) {
  console.error("FORGE_CAPITAL_DB_* missing — quarantine not run live");
  process.exit(2);
}
const core = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

let ingested = 0;
let failed = 0;
for (let i = 0; i < all.length; i += 50) {
  const chunk = all.slice(i, i + 50);
  const { error } = await core.from("import_quarantine").insert(chunk);
  if (error) {
    failed += chunk.length;
    console.error("insert", i, error.message);
  } else {
    ingested += chunk.length;
    console.log("batch", i, "ok", chunk.length, "running_ingested", ingested);
  }
}

const report = {
  ingested,
  failed,
  pending: ingested,
  merged: 0,
  created: 0,
  rejected: 0,
  sum: ingested + failed,
  expected: EXPECTED_DATA_ROWS,
  unique_names: master.uniqueNames,
  dry_run: false,
};
console.log(report);
if (report.sum !== EXPECTED_DATA_ROWS) {
  console.error("COUNT MISMATCH after write");
  process.exit(1);
}
writeFileSync(
  resolve(ROOT, "data/capital-quarantine-report.json"),
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
