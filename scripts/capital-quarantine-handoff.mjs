#!/usr/bin/env node
/**
 * Ingest the current desk (kgkajat campaign_partners) into
 * core.import_quarantine as source grok-handoff. Dry-run default.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");

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

const deskUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const deskKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!deskUrl || !deskKey) {
  console.error("desk SUPABASE_* missing");
  process.exit(2);
}
if (!deskUrl.includes("kgkajatjyqfetdtbzmwg")) {
  console.error("desk URL is not kgkajat — refusing to read the wrong project");
  process.exit(2);
}

const desk = createClient(deskUrl, deskKey, { auth: { persistSession: false } });
const pageSize = 1000;
const rows = [];
for (let from = 0; from < 20000; from += pageSize) {
  const { data, error } = await desk
    .from("campaign_partners")
    .select(
      `id, status_code, status_label, permission_status, last_contact_at,
       partners_mirror:partner_id ( name, email, investors_mirror:investor_id ( firm_name, website ) ),
       campaigns:campaign_id ( name )`,
    )
    .range(from, from + pageSize - 1);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  rows.push(...(data ?? []));
  if (!data || data.length < pageSize) break;
}

const payloads = rows.map((row) => ({
  source: "grok-handoff",
  status: "pending",
  raw_payload: {
    campaign_partner_id: row.id,
    firm: row.partners_mirror?.investors_mirror?.firm_name ?? null,
    website: row.partners_mirror?.investors_mirror?.website ?? null,
    contact: row.partners_mirror?.name ?? null,
    email: row.partners_mirror?.email ?? null,
    campaign: row.campaigns?.name ?? null,
    status_code: row.status_code ?? null,
    status_label: row.status_label ?? null,
    permission_status: row.permission_status ?? null,
    last_contact_at: row.last_contact_at ?? null,
  },
}));

console.log({
  desk_rows: rows.length,
  payloads: payloads.length,
  with_firm: payloads.filter((p) => p.raw_payload.firm).length,
  live: LIVE,
});

if (!LIVE) {
  writeFileSync(
    resolve(ROOT, "data/capital-handoff-report.json"),
    JSON.stringify(
      { at: new Date().toISOString(), desk_rows: rows.length, payloads: payloads.length, dry_run: true },
      null,
      2,
    ),
  );
  process.exit(0);
}

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
  sum: ingested + failed,
  expected: payloads.length,
  dry_run: false,
};
console.log(report);
if (report.sum !== report.expected) process.exit(1);
writeFileSync(
  resolve(ROOT, "data/capital-handoff-report.json"),
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
