#!/usr/bin/env node
/**
 * For each pending import_quarantine row: core.match_firm().
 * exact/alias → status merged. fuzzy/none stay pending for the desk.
 * Never creates firms. Dry-run default. --live writes.
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

const { data: pending, error } = await core
  .from("import_quarantine")
  .select("id, source, raw_payload, status")
  .eq("status", "pending");
if (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = pending ?? [];
const tally = { exact: 0, alias: 0, fuzzy: 0, none: 0, error: 0, merged: 0 };
for (const row of rows) {
  const firm = row.raw_payload?.firm;
  if (!firm) {
    tally.none += 1;
    continue;
  }
  const { data: hit, error: mErr } = await core.rpc("match_firm", { p_name: firm });
  if (mErr) {
    tally.error += 1;
    console.error("match_firm", firm, mErr.message);
    continue;
  }
  const match = Array.isArray(hit) ? hit[0] : hit;
  const kind = match?.match_type ?? "none";
  if (kind === "exact") tally.exact += 1;
  else if (kind === "alias") tally.alias += 1;
  else if (kind === "fuzzy") tally.fuzzy += 1;
  else tally.none += 1;

  const auto = kind === "exact" || kind === "alias";
  if (auto) tally.merged += 1;
  if (!LIVE) continue;
  if (auto && match?.firm_id) {
    const { error: up } = await core
      .from("import_quarantine")
      .update({
        status: "merged",
        suggested_match: match,
        decided_at: new Date().toISOString(),
        decided_by: "app",
      })
      .eq("id", row.id);
    if (up) console.error("update", row.id, up.message);
  } else {
    const { error: up } = await core
      .from("import_quarantine")
      .update({ suggested_match: match ?? { match_type: "none" } })
      .eq("id", row.id);
    if (up) console.error("suggest", row.id, up.message);
  }
}

const report = { live: LIVE, pending: rows.length, ...tally };
console.log(report);
writeFileSync(
  resolve(ROOT, "data/capital-quarantine-resolve.json"),
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
