#!/usr/bin/env node
/**
 * File unresolved review-queue ticks as first-class desk rows.
 * Email is an attribute. No email ⇒ needs-contact partner, still a row.
 * Dry-run default. --live writes.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

const LIVE = process.argv.includes("--live");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const GENERIC = /^(info|contact|hello|enquiries|team|office|invest|investors|ir|admin)@/i;

function normalizeFirm(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^\d+\s+/, "")
    .replace(/\s+\*$/, "")
    .replace(/^#+/, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing supabase env");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const QUEUE = resolve(ROOT, "data/import-review-queue.json");
const rows = existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, "utf8")) : [];
const open = rows.filter((r) => !r.disposition || r.disposition === "unresolved");
console.log("open", open.length, "live", LIVE);

const { data: camps } = await supabase.from("campaigns").select("id, name");
const campByName = new Map((camps ?? []).map((c) => [c.name, c.id]));

const { data: pmax } = await supabase
  .from("partners_mirror")
  .select("id")
  .order("id", { ascending: false })
  .limit(1);
const { data: fmax } = await supabase
  .from("investors_mirror")
  .select("id")
  .order("id", { ascending: false })
  .limit(1);
let nextPartner = Math.max(900_000, (pmax?.[0]?.id ?? 0) + 1);
let nextFirm = Math.max(90_000, (fmax?.[0]?.id ?? 0) + 1);

const firmCache = new Map();
async function firmId(name, website) {
  const key = name.toLowerCase();
  if (firmCache.has(key)) return firmCache.get(key);
  const { data } = await supabase
    .from("investors_mirror")
    .select("id")
    .ilike("firm_name", name)
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    firmCache.set(key, data.id);
    return data.id;
  }
  const id = nextFirm++;
  if (LIVE) {
    const { error } = await supabase.from("investors_mirror").insert({
      id,
      firm_name: name,
      website: website || null,
      type: "desk_filed",
    });
    if (error) throw new Error(`firm ${name}: ${error.message}`);
  }
  firmCache.set(key, id);
  return id;
}

const partnerByEmail = new Map();
const partnerByNameFirm = new Map();
async function partnerId({ name, email, firmId }) {
  const em = email && !GENERIC.test(email) ? email.toLowerCase() : null;
  if (em && partnerByEmail.has(em)) return partnerByEmail.get(em);
  const nf = `${(name || "").toLowerCase()}|${firmId}`;
  if (!em && partnerByNameFirm.has(nf)) return partnerByNameFirm.get(nf);
  if (em) {
    const { data } = await supabase
      .from("partners_mirror")
      .select("id")
      .eq("email", em)
      .maybeSingle();
    if (data?.id) {
      partnerByEmail.set(em, data.id);
      return data.id;
    }
  }
  const id = nextPartner++;
  if (LIVE) {
    const row = {
      id,
      investor_id: firmId,
      name: name || "Needs a named contact",
      email: em,
      kind: "investor",
    };
    const { error } = await supabase.from("partners_mirror").insert(row);
    if (error) throw new Error(`partner ${name} ${em}: ${error.message}`);
  }
  if (em) partnerByEmail.set(em, id);
  else partnerByNameFirm.set(nf, id);
  return id;
}

let created = 0;
let linked = 0;
let skipped = 0;
const updated = [];

for (const raw of open) {
  if (created + linked >= LIMIT) break;
  const firm = normalizeFirm(raw.firm_name);
  const campId = campByName.get(raw.campaign_name);
  if (!firm || !campId) {
    skipped += 1;
    continue;
  }
  const fid = await firmId(firm, raw.website);
  const pid = await partnerId({
    name: raw.contact_name,
    email: raw.email,
    firmId: fid,
  });
  if (!LIVE) {
    created += 1;
    continue;
  }
  const { data: existing } = await supabase
    .from("campaign_partners")
    .select("id")
    .eq("campaign_id", campId)
    .eq("partner_id", pid)
    .maybeSingle();
  if (existing?.id) {
    linked += 1;
  } else {
    const status = String(raw.status_raw ?? "").match(/^([+\-]\d+(?:\.\d+)?)/);
    const { error } = await supabase.from("campaign_partners").insert({
      campaign_id: campId,
      partner_id: pid,
      status_code: status?.[1] ?? "+0",
      status_label: status?.[1] ?? "+0",
      permission_status: "pending_approval",
      last_contact_at: raw.last_contact_at ?? null,
    });
    if (error) {
      console.error("cp", firm, error.message);
      skipped += 1;
      continue;
    }
    created += 1;
  }
  raw.disposition = "matched";
  raw.id = raw.id ?? `filed-${pid}-${campId}`;
  updated.push(raw.id);
}

if (LIVE) {
  writeFileSync(QUEUE, JSON.stringify(rows, null, 2));
}

console.log({ created, linked, skipped, would: !LIVE, remaining_open: open.length - created - linked });
