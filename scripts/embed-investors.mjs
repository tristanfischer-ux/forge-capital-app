#!/usr/bin/env node
/**
 * Re-embed every investor in `investors_mirror` using OpenAI
 * text-embedding-3-small (dimensions=1536). Writes back to the existing
 * `embedding` column so query-time semantic search (via
 * `lib/embeddings/openai.ts`) retrieves against a matching vector
 * space.
 *
 * NOTE: was 768 dims pre 2026-04-23 (nomic-compat era). Switched to 1536
 * when the Supabase pgvector column was migrated. Bug-fix 2026-04-24:
 * the dimensions param in this script lagged the schema migration by 1
 * day, causing every batch to fail with "expected 1536 dimensions, not
 * 768" and breaking investor search end-to-end. Don't drift again.
 *
 * Why we're doing this one-off: the pipeline seeded `embedding` with
 * nomic-embed-text vectors from local Ollama. Those are incompatible
 * with OpenAI query vectors (different model, different space). This
 * script overwrites them with OpenAI vectors so retrieval works.
 *
 * After this runs, the nightly `com.forgecapital.push-embeddings`
 * launchd job (which still pushes nomic vectors from SQLite) will
 * overwrite them again each 06:45 — so this script should either be
 * re-run after each nightly push, OR the nightly job should be
 * disabled. Simplest: schedule THIS script instead of the nomic sync.
 * (Handover note — not done in this commit.)
 *
 * Cost: ~9,349 investors × avg 400 tokens = 3.7M tokens × $0.02/1M
 *       = ~$0.08 for the full re-embed. Rerun is idempotent.
 *
 * Usage:
 *   node scripts/embed-investors.mjs --dry-run --limit 5
 *   node scripts/embed-investors.mjs --limit 50
 *   node scripts/embed-investors.mjs          # full run
 *
 * Env needed (loaded from .env.local):
 *   OPENAI_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env loader — read .env.local without overriding shell env ──────────
function loadEnv() {
  const path = join(__dirname, "..", ".env.local");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // fine — might already be set via shell / launchd
  }
}
loadEnv();

// ── args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1] ?? "0", 10) : 0;
const batchSize = 200; // OpenAI allows up to 2048 inputs per call; 200 is a safe latency target

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[embed] missing Supabase env — aborting");
  process.exit(2);
}
if (!OPENAI_KEY) {
  console.error("[embed] missing OPENAI_API_KEY — aborting");
  process.exit(2);
}
if (!SUPABASE_URL.includes("kgkajatjyqfetdtbzmwg")) {
  console.error(
    `[embed] refusing to run against ${SUPABASE_URL} — expected apex-outreach (kgkajatjyqfetdtbzmwg)`,
  );
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── one embedding batch call ───────────────────────────────────────────
async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: texts,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 400)}`);
  }
  const body = await res.json();
  return body.data.map((d) => d.embedding);
}

// ── build the text per investor — the same shape nomic's pipeline used ─
// matches the pipeline's `research/18-build-embeddings.py` doc shape so
// semantic-similarity results feel the same.
function buildDocText(row) {
  const parts = [];
  if (row.firm_name) parts.push(row.firm_name);
  if (row.type) parts.push(`type: ${row.type}`);
  if (row.hq_location) parts.push(`HQ: ${row.hq_location}`);
  if (row.stage_focus) parts.push(`stages: ${row.stage_focus}`);
  if (row.sector_focus) parts.push(`sectors: ${row.sector_focus}`);
  if (row.geo_focus) parts.push(`geo: ${row.geo_focus}`);
  if (row.thesis_summary) parts.push(row.thesis_summary);
  if (row.thesis_deep) parts.push(row.thesis_deep);
  if (row.investment_pattern) parts.push(row.investment_pattern);
  if (row.connection_brief) parts.push(row.connection_brief);
  if (row.team_expertise) parts.push(row.team_expertise);
  return parts.join(" · ").slice(0, 8000);
}

// ── main ───────────────────────────────────────────────────────────────
(async () => {
  console.log(
    `[embed] start dryRun=${dryRun} limit=${limit || "unbounded"} batch=${batchSize}`,
  );

  // Fetch all actively-deploying investors. Supabase's default select
  // caps at 1000 rows — loop with `.range()` until we exhaust the set.
  const PAGE = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const upper = limit > 0 ? Math.min(offset + PAGE - 1, limit - 1) : offset + PAGE - 1;
    const { data: page, error } = await sb
      .from("investors_mirror")
      .select(
        "id, firm_name, type, hq_location, stage_focus, sector_focus, geo_focus, thesis_summary, thesis_deep, investment_pattern, connection_brief, team_expertise",
      )
      .eq("actively_deploying", true)
      .order("id", { ascending: true })
      .range(offset, upper);
    if (error) {
      console.error("[embed] fetch failed at offset", offset, ":", error.message);
      process.exit(1);
    }
    if (!page || page.length === 0) break;
    rows.push(...page);
    offset += page.length;
    if (page.length < PAGE) break;
    if (limit > 0 && rows.length >= limit) break;
  }
  console.log(`[embed] fetched ${rows.length} rows total`);
  const investors = (rows ?? []).filter((r) => {
    const t = buildDocText(r).trim();
    return t.length >= 30; // skip near-empty rows
  });
  console.log(
    `[embed] eligible investors: ${investors.length} (from ${rows?.length ?? 0} fetched)`,
  );
  if (dryRun) {
    const sample = investors.slice(0, 3);
    for (const s of sample) {
      const text = buildDocText(s);
      console.log(`[embed] [dry] id=${s.id} "${s.firm_name}" chars=${text.length}`);
      console.log(`  text: ${text.slice(0, 200)}...`);
    }
    console.log(`[embed] [dry] would embed ${investors.length} rows in ${Math.ceil(investors.length / batchSize)} batches`);
    return;
  }

  let done = 0;
  let startBatch = Date.now();
  for (let i = 0; i < investors.length; i += batchSize) {
    const batch = investors.slice(i, i + batchSize);
    const texts = batch.map(buildDocText);
    let vectors;
    try {
      vectors = await embedBatch(texts);
    } catch (err) {
      console.error(`[embed] batch ${i}/${investors.length} failed:`, err.message);
      // Fallback: split in half and retry; abort this run if that fails too
      process.exit(1);
    }

    // Upsert per batch — Supabase JS SDK handles the pgvector column
    // as a plain number[] through PostgREST.
    const upserts = batch.map((row, k) => ({
      id: row.id,
      embedding: vectors[k],
    }));
    const { error: upErr } = await sb
      .from("investors_mirror")
      .upsert(upserts, { onConflict: "id" });
    if (upErr) {
      console.error(`[embed] upsert ${i}/${investors.length} failed:`, upErr.message);
      process.exit(1);
    }
    done += batch.length;
    const elapsed = ((Date.now() - startBatch) / 1000).toFixed(1);
    console.log(`[embed]   batch ${Math.floor(i / batchSize) + 1}: ${batch.length} rows in ${elapsed}s (${done}/${investors.length})`);
    startBatch = Date.now();
  }
  console.log(`[embed] done — embedded ${done} investors`);
})().catch((err) => {
  console.error("[embed] fatal:", err);
  process.exit(1);
});
