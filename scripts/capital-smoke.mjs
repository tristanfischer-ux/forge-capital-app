#!/usr/bin/env node
/**
 * Phase 0 smoke against ForgeOS Corpus. Prints counts and gate results.
 * Never prints keys. Cleans up everything it creates.
 *
 * Exit 0 only if every gate blocked as specified.
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
  console.error(
    "FORGE_CAPITAL_DB_URL or FORGE_CAPITAL_DB_SERVICE_ROLE missing — add the service-role key to .env.local",
  );
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const core = createClient(url, key, { ...opts, db: { schema: "core" } });
const engage = createClient(url, key, { ...opts, db: { schema: "engage" } });

const PROBE = "ZZ Smoke Probe";
const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " :: " + detail : ""}`);
  if (!ok) failures.push(label);
}

// ---------- counts ----------
const { count: firmsBefore, error: eFirms } = await core
  .from("firms")
  .select("*", { count: "exact", head: true });
check("core.firms readable", !eFirms, eFirms?.message ?? `${firmsBefore} firms`);

// engage.mandates: the desk column is company_name, not name.
const { data: mandates, error: eMand } = await engage
  .from("mandates")
  .select("code, company_name, status");
const codes = (mandates ?? []).map((m) => m.code).sort().join(" ");
const EXPECTED = "CA FF HO OD PA SK SS US";
check("mandate codes", !eMand && codes === EXPECTED, eMand?.message ?? codes);

// ---------- Gore Street resolves via alias, creates no firm ----------
const { data: gore, error: eGore } = await core.rpc("match_firm", { p_name: "Gore Street" });
const top = Array.isArray(gore) ? gore[0] : gore;
check(
  "match_firm('Gore Street') -> alias",
  !eGore && top?.match_type === "alias" && /Gore Street/.test(top?.canonical_name ?? ""),
  eGore?.message ?? `${top?.canonical_name} / ${top?.match_type} / ${top?.confidence}`,
);

const { data: logged, error: eLog } = await engage.rpc("log_activity", {
  p_firm_name: "Gore Street",
  p_mandate_code: "SS",
  p_occurred_at: new Date().toISOString(),
  p_channel: "note",
  p_subject: "smoke probe",
  p_snippet: "alias resolution check",
  p_created_by: "cowork",
  p_allow_create_firm: false,
});
const { count: firmsAfter } = await core
  .from("firms")
  .select("*", { count: "exact", head: true });
check(
  "log_activity('Gore Street') creates zero firms",
  !eLog && logged?.firm_created === false && firmsBefore === firmsAfter,
  eLog?.message ?? `firm_created=${logged?.firm_created}, firms ${firmsBefore} -> ${firmsAfter}`,
);
if (logged?.activity_id) {
  await engage.from("activity_links").delete().eq("activity_id", logged.activity_id);
  await engage.from("activities").delete().eq("id", logged.activity_id);
}

// ---------- rules battery ----------
const { data: gresham } = await core
  .from("firms")
  .select("id")
  .eq("canonical_name", "Gresham House")
  .maybeSingle();
const { data: clean } = await core
  .from("firms")
  .select("id")
  .eq("canonical_name", "Just Climate")
  .maybeSingle();
const { data: mandate } = await engage
  .from("mandates")
  .select("id")
  .eq("code", "SS")
  .maybeSingle();

// A non-DNC, unverified person, so the email gate is what trips — not person-DNC.
const { data: probe, error: eProbe } = await core
  .from("people")
  .insert({
    firm_id: clean?.id,
    full_name: PROBE,
    email: "zz@example.invalid",
    email_state: "unknown",
    dnc: false,
    provenance: "smoke",
  })
  .select("id")
  .maybeSingle();
if (eProbe) {
  console.error("could not create probe person:", eProbe.message);
  process.exit(1);
}

async function mustBlock(label, row, expect) {
  const { data, error } = await engage
    .from("participations")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (!error) {
    await engage.from("participations").delete().eq("id", data.id);
    check(label, false, "insert SUCCEEDED — gate did not fire");
    return;
  }
  check(label, expect.test(error.message), error.message);
}

await mustBlock(
  "(a) approach Gresham House BLOCKED",
  { firm_id: gresham?.id, person_id: probe.id, mandate_id: mandate?.id, stage: "approached", created_by: "app" },
  /do-not-contact/i,
);
await mustBlock(
  "(b) unverified email BLOCKED",
  { firm_id: clean?.id, person_id: probe.id, mandate_id: mandate?.id, stage: "approached", created_by: "app" },
  /Rule 13.*verified/i,
);
await mustBlock(
  "(c) no named individual BLOCKED",
  { firm_id: clean?.id, person_id: null, mandate_id: mandate?.id, stage: "approached", created_by: "app" },
  /Rule 13.*named individual/i,
);

// (d) dnc=false without clear_dnc must raise.
const { error: eDnc } = await core.from("firms").update({ dnc: false }).eq("id", gresham?.id);
check("(d) dnc=false without clear_dnc raises", Boolean(eDnc) && /clear_dnc/.test(eDnc?.message ?? ""), eDnc?.message ?? "update SUCCEEDED");

// ---------- cleanup ----------
await core.from("people").delete().eq("id", probe.id);
const { data: stillDnc } = await core
  .from("firms")
  .select("dnc")
  .eq("id", gresham?.id)
  .maybeSingle();
check("Gresham House still dnc after battery", stillDnc?.dnc === true, `dnc=${stillDnc?.dnc}`);

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nall gates held");
process.exit(failures.length ? 1 : 0);
