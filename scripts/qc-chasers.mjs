#!/usr/bin/env node
/**
 * Prove chaser lists against Corpus. No UI. Exit 1 if YU or PA is empty.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const core = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  ...opts,
  db: { schema: "core" },
});
const engage = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  ...opts,
  db: { schema: "engage" },
});

async function inChunks(ids, load, size = 50) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    out.push(...(await load(chunk)));
  }
  return out;
}

async function listChasers(code, quietDays = 10) {
  const { data: mandate } = await engage.from("mandates").select("id").eq("code", code).maybeSingle();
  if (!mandate) return { n: 0, error: "no mandate" };
  const { data: parts, error } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, first_sent, latest_touch")
    .eq("mandate_id", mandate.id)
    .not("person_id", "is", null)
    .in("stage", ["research", "approved", "approached", "responded", "meeting"])
    .limit(400);
  if (error) return { n: 0, error: error.message };
  const personIds = [...new Set(parts.map((p) => p.person_id).filter(Boolean))];
  const people = await inChunks(personIds, async (chunk) => {
    const { data } = await core.from("people").select("id, dnc").in("id", chunk);
    return data ?? [];
  });
  const personBy = Object.fromEntries(people.map((p) => [p.id, p]));
  const now = Date.now();
  let n = 0;
  for (const p of parts) {
    const person = personBy[p.person_id];
    if (!person || person.dnc) continue;
    const outAt = p.latest_touch || p.first_sent;
    if (!outAt) continue;
    const t = Date.parse(outAt.includes("T") ? outAt : `${outAt}T12:00:00Z`);
    if (!Number.isFinite(t)) continue;
    if (Math.floor((now - t) / 86400000) < quietDays) continue;
    n++;
  }
  return { n, parts: parts.length, people: people.length };
}

const results = {};
for (const code of ["YU", "PA", "SS", "FF", "SK", "OD"]) {
  results[code] = await listChasers(code);
  console.log(code, results[code]);
}
if (results.YU.n < 10 || results.PA.n < 10) {
  console.error("FAIL chaser floors");
  process.exit(1);
}
console.log("PASS chaser floors");
