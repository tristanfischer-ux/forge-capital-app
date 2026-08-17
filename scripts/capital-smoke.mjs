#!/usr/bin/env node
/**
 * Phase 0 smoke against ForgeOS Corpus. Prints counts and gate results.
 * Never prints keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  console.error("FORGE_CAPITAL_DB_URL or FORGE_CAPITAL_DB_SERVICE_ROLE missing — add the service-role key to .env.local");
  process.exit(2);
}

const core = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "core" },
});
const engage = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "engage" },
});

const { count: firms, error: e1 } = await core.from("firms").select("*", { count: "exact", head: true });
const { data: mandates, error: e2 } = await engage.from("mandates").select("code, name, status");
const { data: gore, error: e3 } = await core.rpc("match_firm", { name: "Gore Street" });

console.log("firms", e1?.message ?? firms);
console.log("mandates", e2?.message ?? (mandates ?? []).map((m) => m.code).join(" "));
console.log("match_firm Gore Street", e3?.message ?? gore);

const { data: gresham, error: e4 } = await engage
  .from("participations")
  .insert({ stage: "approached", status_note: "smoke — must fail" })
  .select("id")
  .maybeSingle();
console.log("gresham insert (expect fail)", e4?.message ?? gresham);
