#!/usr/bin/env node
/**
 * Port ALIASES from research/_space_funding_12m_xref.py plus desk
 * identity seeds into core.firm_aliases. Dry-run default. --live writes.
 * Calls match_firm before create. Never prints secrets.
 */
import { existsSync, readFileSync } from "node:fs";
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

function parsePyAliases() {
  const file = resolve(
    ROOT,
    "../Forge-Capital/research/_space_funding_12m_xref.py",
  );
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const start = text.indexOf("ALIASES = {");
  if (start < 0) return [];
  const slice = text.slice(start + "ALIASES = ".length);
  const pairs = [...slice.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)];
  return pairs.map((m) => ({ alias: m[1], canonical: m[2] }));
}

const DESK = [
  { alias: "13 Project A Ventures", canonical: "Project A" },
  { alias: "Project A Ventures", canonical: "Project A" },
  { alias: "14 Vsquared Ventures", canonical: "Vsquared Ventures" },
  { alias: "12 Playground Global", canonical: "Playground Global" },
  { alias: "3 HV Capital *", canonical: "HV Capital" },
  { alias: "11 Metaplanet", canonical: "Metaplanet" },
];

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

const aliases = [...parsePyAliases(), ...DESK];
console.log("aliases_loaded", aliases.length, "live", LIVE);

let inserted = 0;
let skipped = 0;
let unmatched = 0;
for (const { alias, canonical } of aliases) {
  const { data: hit, error } = await core.rpc("match_firm", { name: canonical });
  if (error) {
    console.error("match_firm", canonical, error.message);
    unmatched += 1;
    continue;
  }
  const firmId = Array.isArray(hit) ? hit[0]?.firm_id : hit?.firm_id;
  if (!firmId) {
    unmatched += 1;
    continue;
  }
  if (!LIVE) {
    inserted += 1;
    continue;
  }
  const { error: ins } = await core.from("firm_aliases").insert({
    firm_id: firmId,
    alias,
  });
  if (ins) {
    if (/unique|duplicate/i.test(ins.message)) skipped += 1;
    else console.error("alias", alias, ins.message);
  } else inserted += 1;
}

console.log({ inserted, skipped, unmatched, would: !LIVE });
