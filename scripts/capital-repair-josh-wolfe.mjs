#!/usr/bin/env node
/** One-shot: Josh Wolfe must exist at Lux Capital with his own email. */
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

const core = createClient(process.env.FORGE_CAPITAL_DB_URL, process.env.FORGE_CAPITAL_DB_SERVICE_ROLE, {
  auth: { persistSession: false },
  db: { schema: "core" },
});

const EMAIL = "josh.wolfe@luxcapital.com";
const { data: firm } = await core
  .from("firms")
  .select("id, canonical_name")
  .eq("canonical_name", "Lux Capital")
  .maybeSingle();
if (!firm) {
  console.error("Lux Capital firm missing");
  process.exit(1);
}

const { data: existing } = await core
  .from("people")
  .select("id, full_name, email")
  .eq("email", EMAIL);
for (const row of existing ?? []) {
  if ((row.full_name ?? "").toLowerCase() === "josh wolfe") {
    console.log(JSON.stringify({ ok: true, already: row.id }));
    process.exit(0);
  }
  await core.from("people").update({ email: null }).eq("id", row.id);
}

const { data: created, error } = await core
  .from("people")
  .insert({
    firm_id: firm.id,
    full_name: "Josh Wolfe",
    email: EMAIL,
    email_state: "unknown",
    role_title: "Co-founder / Partner",
    provenance: "repair-josh-wolfe",
    notes: "Email moved off a mis-filed row so search and Rule 13 attach to the named partner.",
  })
  .select("id")
  .maybeSingle();
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, id: created?.id, firm: firm.canonical_name }));
