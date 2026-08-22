#!/usr/bin/env node
/**
 * Phase 1 acceptance — gates, email_drafts, audit. No send. No forge.backfill.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.FORGE_CAPITAL_DB_URL;
const key = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
const engage = createClient(url, key, { auth: { persistSession: false }, db: { schema: "engage" } });
const core = createClient(url, key, { auth: { persistSession: false }, db: { schema: "core" } });

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}

const { count: verified } = await core.from("people").select("id", { count: "exact", head: true }).eq("email_state", "verified");
const { count: approached } = await engage.from("participations").select("id", { count: "exact", head: true }).eq("stage", "approached");
const { count: draftsBefore } = await engage.from("email_drafts").select("id", { count: "exact", head: true });
const { count: appAuditsBefore } = await engage.from("audit_log").select("id", { count: "exact", head: true }).eq("actor", "app");
console.log("BEFORE", { verified, approached, drafts: draftsBefore, app_audits: appAuditsBefore });

const { data: sample } = await engage
  .from("participations")
  .select("id, stage, person_id")
  .eq("stage", "approved")
  .not("person_id", "is", null)
  .limit(1)
  .maybeSingle();
if (!sample?.id) fail("no approved participation to test");

const { data: gate, error: gateErr } = await engage.rpc("check_outreach_allowed", {
  p_participation: sample.id,
});
if (gateErr) fail("rpc error " + gateErr.message);
const row = Array.isArray(gate) ? gate[0] : gate;
if (row?.allowed === true) fail("expected unverified approved row to be blocked");
if (!String(row?.reason ?? "").toLowerCase().includes("verified") && !String(row?.reason ?? "").toLowerCase().includes("rule 13")) {
  fail("unexpected reason: " + JSON.stringify(row));
}
console.log("TEST rpc check_outreach_allowed allowed=false reason=", row.reason);

const { error: updErr } = await engage.from("participations").update({ stage: "approached" }).eq("id", sample.id);
if (!updErr) fail("update to approached succeeded — trigger did not fire");
if (!updErr.message.includes("BLOCKED")) fail("update error was not verbatim BLOCKED: " + updErr.message);
console.log("TEST update approached blocked verbatim:", updErr.message);

const dummy = {
  participation_id: sample.id,
  gmail_draft_id: "phase1-test-" + Date.now(),
  kind: "first_touch",
  chase_number: 0,
  subject: "Phase 1 gate test — delete me",
  body_hash: "test",
  word_count: 3,
  has_unresolved_attach_marker: false,
  created_by: "app",
};
const { data: inserted, error: insErr } = await engage.from("email_drafts").insert(dummy).select("id").maybeSingle();
if (insErr) fail("email_drafts insert " + insErr.message);
const { error: audErr } = await engage.from("audit_log").insert({
  actor: "app",
  action: "phase1.gate_test",
  entity: `email_drafts:${inserted.id}`,
  reason: "acceptance test",
});
if (audErr) fail("audit_log insert " + audErr.message);
await engage.from("email_drafts").delete().eq("id", inserted.id);

const { count: draftsAfter } = await engage.from("email_drafts").select("id", { count: "exact", head: true });
const { count: appAuditsAfter } = await engage.from("audit_log").select("id", { count: "exact", head: true }).eq("actor", "app");
const { data: sync } = await engage.from("sync_state").select("feed, last_ok_at, last_error");

console.log("AFTER", { drafts: draftsAfter, app_audits: appAuditsAfter, sync });
if ((appAuditsAfter ?? 0) < 1) fail("expected at least one actor=app audit row");
console.log("PASS phase 1 gates: RPC blocks, trigger blocks verbatim, email_drafts writable, app audit written");
process.exit(0);
