#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[line.slice(0, i).trim()] = v;
  }
}
loadEnv();

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " :: " + detail : ""}`);
  if (!ok) failures.push(label);
}

check("NEVERBOUNCE_API_KEY present", Boolean(process.env.NEVERBOUNCE_API_KEY?.trim()));
check("CRON_SECRET present", Boolean(process.env.CRON_SECRET?.trim()));

const core = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  auth: { persistSession: false },
  db: { schema: "core" },
});
const engage = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  auth: { persistSession: false },
  db: { schema: "engage" },
});

const { data: josh } = await core
  .from("people")
  .select("id, full_name, email")
  .ilike("full_name", "%josh wolfe%");
check("Josh Wolfe exists as a named person", (josh ?? []).some((p) => /josh wolfe/i.test(p.full_name ?? "")), JSON.stringify(josh));

const { data: emailHit } = await core
  .from("people")
  .select("id, full_name, email")
  .ilike("email", "%josh.wolfe%");
check("josh.wolfe@ is on the book", (emailHit ?? []).length > 0, JSON.stringify(emailHit));

const orig = resolve(process.env.HOME, "Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx");
const st = existsSync(orig);
check("260817 original still on disk", st);

if (failures.length) {
  console.error(`FAILED ${failures.length}`);
  process.exit(1);
}
console.log("OK");
process.exit(0);
