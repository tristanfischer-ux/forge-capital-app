#!/usr/bin/env node
/**
 * Backup workbook FROM the shared book. Never writes the 260817 original.
 * Default output: ~/Developer/Forge-Capital/YYMMDD Master Investor Tracker TF (CANONICAL).xlsx
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = resolve(
  homedir(),
  "Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx",
);

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

async function allRows(client, table, select) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(table + " " + error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const [firms, people, parts, mandates] = await Promise.all([
  allRows(core, "firms", "id, canonical_name, website_domain, sectors, dnc, notes"),
  allRows(core, "people", "id, firm_id, full_name, email, email_state, dnc"),
  allRows(engage, "participations", "firm_id, person_id, mandate_id, stage, status_note, first_sent, latest_touch"),
  engage.from("mandates").select("id, code").then((r) => {
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  }),
]);

const codeByMandate = Object.fromEntries(mandates.map((m) => [m.id, m.code]));
const peopleByFirm = new Map();
for (const p of people) {
  if (!peopleByFirm.has(p.firm_id)) peopleByFirm.set(p.firm_id, []);
  peopleByFirm.get(p.firm_id).push(p);
}
const partsByFirm = new Map();
for (const p of parts) {
  if (!partsByFirm.has(p.firm_id)) partsByFirm.set(p.firm_id, []);
  partsByFirm.get(p.firm_id).push(p);
}

const TEMPLATE = resolve(
  homedir(),
  "Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx",
);
const CODES = ["SK", "FF", "PA", "SS", "CA", "US", "OD", "HO"];
const LATEST_COLS = ["Q", "V", "AA", "AF", "AK", "AP", "AU", "AZ"]; // 1-based Excel letters for Latest in each block
const header1 = [
  "LAST CONTACT", "CONTACTED?", null, null, null, null, null, null, null,
  "INVESTOR INFO", null, null, null, null, null,
  "SKYSAILS POWER", null, null, null, null,
  "FISHFROM", null, null, null, null,
  "PANATERE", null, null, null, null,
  "SPACE SOLAR", null, null, null, null,
  "CASPER FUNDING", null, null, null, null,
  "US ARBITRAGE", null, null, null, null,
  "ODYSSEUS SPACE", null, null, null, null,
  "HOOLEY RF", null, null, null, null,
];
const header2 = [
  "Days ago", "SkySails", "FishFrom", "Panatere", "Space Solar", "Casper", "US Arb", "Odysseus", "Hooley",
  "Investor", "Website", "Contact", "Email", "Sector", "# Co",
];
for (let i = 0; i < 8; i++) header2.push("First Sent", "Latest", "Days Since", "Status", "Commentary");

const aoa = [header1, header2];
const sorted = firms.slice().sort((a, b) =>
  String(a.canonical_name).localeCompare(String(b.canonical_name), "en"),
);

for (const f of sorted) {
  const plist = peopleByFirm.get(f.id) ?? [];
  const named = plist.find((p) => !p.dnc) ?? plist[0];
  const pp = partsByFirm.get(f.id) ?? [];
  const byCode = {};
  for (const p of pp) {
    const c = codeByMandate[p.mandate_id];
    if (c) byCode[c] = p;
  }
  const row = new Array(55).fill(null);
  row[9] = f.canonical_name;
  row[10] = f.website_domain;
  row[11] = named?.full_name ?? null;
  row[12] = named?.email ?? null;
  row[13] = Array.isArray(f.sectors) ? f.sectors.join(", ") : f.sectors;
  row[14] = pp.length || null;
  if (f.dnc) row[13] = [row[13], "DNC"].filter(Boolean).join(" | ");
  CODES.forEach((code, i) => {
    const p = byCode[code];
    const base = 15 + i * 5;
    if (!p) return;
    row[1 + i] = "✓";
    row[base] = p.first_sent ? String(p.first_sent).slice(0, 10) : null;
    row[base + 1] = p.latest_touch ? String(p.latest_touch).slice(0, 10) : null;
    row[base + 3] = p.status_note || p.stage;
    row[base + 4] = p.status_note;
  });
  aoa.push(row);
}

if (!existsSync(TEMPLATE)) {
  console.error("template missing", TEMPLATE);
  process.exit(2);
}
const template = XLSX.readFile(TEMPLATE, { cellDates: true, cellFormula: true });
const master = XLSX.utils.aoa_to_sheet(aoa);
const DAYS_COLS = ["R", "W", "AB", "AG", "AL", "AQ", "AV", "BA"];
const lastRow = 2 + sorted.length;
for (let r = 3; r <= lastRow; r += 1) {
  const maxList = LATEST_COLS.map((c) => `${c}${r}`).join(",");
  master[`A${r}`] = {
    t: "n",
    f: `IF(MAX(${maxList})=0,"",TODAY()-MAX(${maxList}))`,
  };
  DAYS_COLS.forEach((daysCol, i) => {
    const latest = LATEST_COLS[i];
    master[`${daysCol}${r}`] = {
      t: "n",
      f: `IF(${latest}${r}="","",TODAY()-${latest}${r})`,
    };
  });
}
if (master["!ref"]) {
  master["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow - 1, c: 54 },
  });
}
const wb = {
  SheetNames: [...template.SheetNames],
  Sheets: {},
};
for (const name of template.SheetNames) {
  wb.Sheets[name] = name === "Master Tracker" ? master : template.Sheets[name];
}
if (!wb.SheetNames.includes("Generated")) wb.SheetNames.push("Generated");
wb.Sheets.Generated = XLSX.utils.aoa_to_sheet([
  ["Generated from the shared book (core/engage). Do not type in this file."],
  ["The 17 Aug original was not modified."],
  ["Generated", new Date().toISOString()],
  ["Firms", firms.length],
  ["People", people.length],
  ["Participations", parts.length],
]);

const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, "");
const out = resolve(
  homedir(),
  `Developer/Forge-Capital/${yymmdd} Master Investor Tracker TF (CANONICAL).xlsx`,
);
if (resolve(out) === resolve(FORBIDDEN) || out.includes("260817")) {
  console.error("refusing to write the 17 Aug original");
  process.exit(2);
}
writeFileSync(out, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log({ out, firms: firms.length, people: people.length, participations: parts.length, data_rows: aoa.length - 2 });
