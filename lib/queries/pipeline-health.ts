import { stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { createServerClient } from "@/lib/supabase/server";

/**
 * Pipeline health — the data the /pipeline dashboard renders.
 *
 * The "pipeline" is nine launchd agents on Tristan's Mac that push rows
 * into Supabase on a schedule. The web app has no "run now" button — it
 * cannot start these jobs. What it CAN do is read three sources and
 * report where each stage stands right now:
 *
 *   1. Supabase counts — investors_mirror, partners_mirror,
 *      campaign_partners, contact_events, partner_email_hunt_requests.
 *   2. Max-timestamp columns (synthesized_at, last_synced_at) as the
 *      "last run" signal when the server has no filesystem access.
 *   3. On localhost only, the mtime of ~/.forge-capital/<script>.log
 *      for agents whose log file is the best freshness signal.
 *
 * Vercel runtimes cannot read Tristan's home directory, so the fs probe
 * is gated behind process.env.VERCEL !== "1". On production, every
 * stage falls back to the Supabase-visible signal; on localhost the
 * dashboard augments with real cron log mtimes.
 *
 * Never fabricate a timestamp. If the signal is missing, render "—"
 * with a warn status so the UI says "we don't know, go check".
 */

export type StageStatus = "ok" | "warn" | "broken";

/** One row in the stepper. */
export interface PipelineStage {
  /** Stable slug for React keys + sub-row tooltips. */
  id: string;
  /** Short stage label (e.g. "Discover", "Enrich"). */
  label: string;
  /** One-line description rendered under the label. */
  hint: string;
  /** Matching launchd plist label, if any. */
  launchdLabel: string | null;
  /** Scheduled cadence, verbatim from the plist (e.g. "Daily 06:00"). */
  cadence: string | null;
  /** The numeric signal this stage owns (e.g. row count, queue depth). */
  count: number;
  /** Label for the count ("active investors", "with synthesis", …). */
  countLabel: string;
  /** Source of the count, one sentence. */
  countSource: string;
  /** Most recent run we can observe, as an ISO timestamp. Null = unknown. */
  lastRunAt: string | null;
  /** One sentence explaining where lastRunAt came from. */
  lastRunSource: string;
  /** Derived health from lastRunAt + thresholds. */
  status: StageStatus;
  /** One-line reason for the status — drives the chip tooltip. */
  statusReason: string;
}

/** One bucket of the 7-day enrichment throughput bar chart. */
export interface EnrichmentDay {
  /** ISO date for the bucket start (local-time). */
  day: string;
  /** How many investor rows were (re-)synthesised that day. */
  count: number;
}

export interface PipelineHealth {
  /** The nine stages, in pipeline order. */
  stages: PipelineStage[];
  /** Last 7 days (inclusive of today). */
  enrichment7d: EnrichmentDay[];
  /** Total count of pending hunt requests — for the header pill. */
  huntQueuePending: number;
  /** Most recent full-pipeline cron run we can see, ISO. Null if unknown. */
  lastBatchAt: string | null;
  /** Human copy for "next scheduled run" — comes from the launchd plist. */
  nextScheduledAt: string;
  /** True when the server was able to read ~/.forge-capital/*.log mtimes. */
  fsProbeAvailable: boolean;
}

/* -------------------------------------------------------------------
   Log-file mtime probe (localhost only)
   ------------------------------------------------------------------- */

const FORGE_LOG_DIR = path.join(os.homedir(), ".forge-capital");

async function readLogMtime(filename: string): Promise<Date | null> {
  // Vercel's filesystem has no ~/.forge-capital. Skip the stat call
  // rather than let it throw up a red line in every server log.
  if (process.env.VERCEL === "1") return null;
  try {
    const s = await stat(path.join(FORGE_LOG_DIR, filename));
    return s.mtime;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------
   Status classifier
   ------------------------------------------------------------------- */

/**
 * Classify a stage by the age of its freshness signal.
 *   <= 24h  → ok
 *   <= 72h  → warn
 *   >  72h  → broken (we care about "the pipeline has clearly stopped")
 *   > 7d    → still broken, same chip — but the reason string notes it
 *
 * When lastRunAt is null we default to "warn" with a reason of
 * "no visible signal" — we refuse to call it broken without evidence.
 */
function classify(
  lastRunAt: Date | null,
  sourceLabel: string,
): { status: StageStatus; reason: string } {
  if (!lastRunAt) {
    return {
      status: "warn",
      reason: `No ${sourceLabel} observed — verify the cron is running.`,
    };
  }
  const ageMs = Date.now() - lastRunAt.getTime();
  const hours = ageMs / (1000 * 60 * 60);
  if (hours <= 24) return { status: "ok", reason: `Fresh — ${sourceLabel} within the last 24h.` };
  if (hours <= 72) {
    const h = Math.round(hours);
    return { status: "warn", reason: `Last ${sourceLabel} ${h}h ago (> 24h).` };
  }
  const days = Math.round(hours / 24);
  return { status: "broken", reason: `Last ${sourceLabel} ${days}d ago (> 72h) — cron may be stuck.` };
}

/* -------------------------------------------------------------------
   Supabase count helpers
   ------------------------------------------------------------------- */

/**
 * Wraps a head: true count query to return a clean number. Returns -1
 * on failure so downstream code can render an honest error state.
 */
async function safeCount(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  table: string,
  applyFilter?: (
    q: ReturnType<
      ReturnType<typeof createServerClient> extends Promise<infer C>
        ? C extends { from: (t: string) => infer F }
          ? () => F
          : never
        : never
    >,
  ) => unknown,
): Promise<number> {
  // Casting is unavoidable because supabase-js overloads confuse the
  // generic `applyFilter` callback above. The runtime shape is fine.
  let query = supabase
    .from(table)
    .select("*", { count: "exact", head: true }) as unknown as {
    count: number | null;
  };
  if (applyFilter) {
    query = applyFilter(query as unknown as never) as typeof query;
  }
  const { count, error } = (await (query as unknown as Promise<{
    count: number | null;
    error: unknown;
  }>)) as { count: number | null; error: { message?: string } | null };
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[pipeline-health] count(${table}) failed:`, error.message);
    return -1;
  }
  return count ?? 0;
}

/* -------------------------------------------------------------------
   The stages
   ------------------------------------------------------------------- */

/**
 * Stage catalogue, in pipeline order. Static config lifted from the
 * launchd plists in ~/Library/LaunchAgents; freshness signals resolved
 * at request time.
 *
 * The stages we ship: discover → enrich → synthesise → push → email-verify
 * → email-hunt-queue → gmail-sync → send → parse-reply. Nine, matching the
 * V4 nine-lane kanban that preceded this page — but the rows here are
 * cron stages, not status lanes.
 */
export async function getPipelineHealth(): Promise<PipelineHealth> {
  const supabase = await createServerClient();

  // Kick every independent read off in parallel — we do ~10 of them and
  // the page would be >3s sequentially.
  const [
    investorsActive,
    investorsTotal,
    synthesisPresent,
    synthesizedAtPresent,
    latestSynth,
    partnersHunterOrCorresponded,
    partnersUnverified,
    huntPending,
    huntResolved,
    contactEventsTotal,
    latestEvent,
    sentEvents,
    replyEvents,
    enrichment7d,
    // fs mtimes — all null on Vercel
    discoverMtime,
    pushMtime,
    reverifyMtime,
    pipelineMtime,
    weeklyMtime,
  ] = await Promise.all([
    safeCount(supabase, "investors_mirror", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq(
        "actively_deploying",
        true,
      ),
    ),
    safeCount(supabase, "investors_mirror"),
    safeCount(supabase, "investors_mirror", (q) =>
      (q as unknown as { not: (col: string, op: string, v: unknown) => unknown }).not(
        "synthesis_data",
        "is",
        null,
      ),
    ),
    safeCount(supabase, "investors_mirror", (q) =>
      (q as unknown as { not: (col: string, op: string, v: unknown) => unknown }).not(
        "synthesized_at",
        "is",
        null,
      ),
    ),
    fetchMaxSynthesizedAt(supabase),
    safeCount(supabase, "partners_mirror", (q) =>
      (q as unknown as { in: (col: string, v: unknown[]) => unknown }).in("email_tier", [
        "hunter_verified",
        "corresponded",
      ]),
    ),
    safeCount(supabase, "partners_mirror", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq(
        "email_tier",
        "unverified",
      ),
    ),
    safeCount(supabase, "partner_email_hunt_requests", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq("status", "pending"),
    ),
    safeCount(supabase, "partner_email_hunt_requests", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq("status", "resolved"),
    ),
    safeCount(supabase, "contact_events"),
    fetchMaxEventAt(supabase),
    safeCount(supabase, "contact_events", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq("direction", "outbound"),
    ),
    safeCount(supabase, "contact_events", (q) =>
      (q as unknown as { eq: (col: string, v: unknown) => unknown }).eq("direction", "inbound"),
    ),
    fetchEnrichment7d(supabase),
    readLogMtime("discover-launchd.log"),
    readLogMtime("push-capital-app.log"),
    readLogMtime("nightly-reverify.log"),
    readLogMtime("full-pipeline-launchd.log"),
    readLogMtime("weekly-draft.log"),
  ]);

  const pipelineMtimeMs = pipelineMtime?.getTime() ?? 0;
  const pushMtimeMs = pushMtime?.getTime() ?? 0;
  const lastBatch = pipelineMtimeMs > pushMtimeMs ? pipelineMtime : pushMtime;

  const stages: PipelineStage[] = [];

  // ----- 1. Discover -------------------------------------------------
  {
    const { status, reason } = classify(discoverMtime, "log write");
    stages.push({
      id: "discover",
      label: "Discover",
      hint: "Brave Search + website scrape finds new investor firms.",
      launchdLabel: "com.forgecapital.discover",
      cadence: "Weekly · Sunday 03:00",
      count: investorsTotal < 0 ? 0 : investorsTotal,
      countLabel: "investors in the mirror",
      countSource: "COUNT(*) from public.investors_mirror",
      lastRunAt: discoverMtime?.toISOString() ?? null,
      lastRunSource: discoverMtime
        ? "mtime of ~/.forge-capital/discover-launchd.log"
        : "log mtime unavailable on this host",
      status,
      statusReason: reason,
    });
  }

  // ----- 2. Enrich (active_deploying = currently in play) -----------
  //
  // The enrich step writes `actively_deploying`. Freshness is inferred
  // from the nightly-reverify log mtime (run: 19:00). Synthesis (stage 3)
  // has its own stronger signal via synthesized_at.
  {
    const { status, reason } = classify(reverifyMtime, "reverify log write");
    stages.push({
      id: "enrich",
      label: "Enrich",
      hint: "Companies House + website enrichment + actively-deploying flag.",
      launchdLabel: "com.forgecapital.nightly-reverify",
      cadence: "Daily 19:00",
      count: investorsActive < 0 ? 0 : investorsActive,
      countLabel: "active investors",
      countSource: "COUNT(*) WHERE actively_deploying IS TRUE",
      lastRunAt: reverifyMtime?.toISOString() ?? null,
      lastRunSource: reverifyMtime
        ? "mtime of ~/.forge-capital/nightly-reverify.log"
        : "log mtime unavailable on this host",
      status,
      statusReason: reason,
    });
  }

  // ----- 3. Synthesise (Ollama LLM summaries) -----------------------
  {
    const latest = latestSynth ? new Date(latestSynth) : null;
    const { status, reason } = classify(latest, "synthesis");
    stages.push({
      id: "synthesise",
      label: "Synthesise",
      hint: "qwen3.5:27b writes investor thesis + connection brief.",
      launchdLabel: "com.forgecapital.full-pipeline",
      cadence: "Daily 06:00 (bundled with full pipeline)",
      count: synthesisPresent < 0 ? 0 : synthesisPresent,
      countLabel: "with synthesis",
      countSource: "COUNT(*) WHERE synthesis_data IS NOT NULL",
      lastRunAt: latest?.toISOString() ?? null,
      lastRunSource: "MAX(synthesized_at) on public.investors_mirror",
      status,
      statusReason: reason,
    });
  }

  // ----- 4. Push (SQLite → Supabase mirror) -------------------------
  {
    const { status, reason } = classify(pushMtime, "mirror push");
    stages.push({
      id: "push",
      label: "Push to Supabase",
      hint: "Nightly dump of SQLite source-of-truth into investors_mirror.",
      launchdLabel: "com.forgecapital.push-capital-app",
      cadence: "Daily 06:30",
      count: synthesizedAtPresent < 0 ? 0 : synthesizedAtPresent,
      countLabel: "rows tagged synthesized_at",
      countSource: "COUNT(*) WHERE synthesized_at IS NOT NULL",
      lastRunAt: pushMtime?.toISOString() ?? null,
      lastRunSource: pushMtime
        ? "mtime of ~/.forge-capital/push-capital-app.log"
        : "log mtime unavailable on this host",
      status,
      statusReason: reason,
    });
  }

  // ----- 5. Email-verify (Hunter / corresponded) -------------------
  {
    // Freshness uses the same reverify log (Hunter re-checks run there).
    const { status, reason } = classify(reverifyMtime, "reverify log write");
    stages.push({
      id: "email-verify",
      label: "Email verify",
      hint: "Hunter s≥80 + corresponded tiers — only these can be drafted.",
      launchdLabel: "com.forgecapital.nightly-reverify",
      cadence: "Daily 19:00",
      count: partnersHunterOrCorresponded < 0 ? 0 : partnersHunterOrCorresponded,
      countLabel: "partners verified (hunter + corresponded)",
      countSource:
        "COUNT(*) WHERE email_tier IN ('hunter_verified','corresponded')",
      lastRunAt: reverifyMtime?.toISOString() ?? null,
      lastRunSource: reverifyMtime
        ? "mtime of ~/.forge-capital/nightly-reverify.log"
        : "log mtime unavailable on this host",
      status,
      statusReason: reason,
    });
  }

  // ----- 6. Email hunt queue ---------------------------------------
  //
  // No cron writes this — users do. Freshness = "pending rows waiting".
  // Status: 0 pending is ok (nothing queued), 1-25 warn, 25+ broken
  // (queue is growing faster than the cron drains it).
  {
    const pending = huntPending < 0 ? 0 : huntPending;
    const resolved = huntResolved < 0 ? 0 : huntResolved;
    let status: StageStatus;
    let reason: string;
    if (pending === 0) {
      status = "ok";
      reason = "No partners queued — Hunter pipeline is caught up.";
    } else if (pending <= 25) {
      status = "ok";
      reason = `${pending} partner${pending === 1 ? "" : "s"} queued for Hunter — well within the overnight window.`;
    } else if (pending <= 100) {
      status = "warn";
      reason = `${pending} partners queued — watch that the nightly run clears them.`;
    } else {
      status = "broken";
      reason = `${pending} partners queued — the nightly Hunter run isn't keeping up.`;
    }
    stages.push({
      id: "email-hunt-queue",
      label: "Email hunt queue",
      hint: "Manual requests: Find-a-Match “Resolve email” sends rows here.",
      launchdLabel: null,
      cadence: "Drained by the nightly pipeline — no cron of its own",
      count: pending,
      countLabel: "pending hunt requests",
      countSource:
        "COUNT(*) FROM partner_email_hunt_requests WHERE status = 'pending'",
      lastRunAt: null,
      lastRunSource: `${resolved} resolved to date`,
      status,
      statusReason: reason,
    });
  }

  // ----- 7. Gmail sync ---------------------------------------------
  //
  // Not yet deployed. contact_events table is empty. Render an honest
  // "not yet deployed" state with count from whatever is there (0 today).
  {
    const events = contactEventsTotal < 0 ? 0 : contactEventsTotal;
    const latest = latestEvent ? new Date(latestEvent) : null;
    let status: StageStatus;
    let reason: string;
    if (events === 0) {
      status = "warn";
      reason =
        "Gmail sync not yet deployed — stats will populate once com.forgecapital.gmail-sync lands.";
    } else if (!latest) {
      status = "warn";
      reason = "Events present but no MAX(event_at) — check the table.";
    } else {
      const ageMin = (Date.now() - latest.getTime()) / (1000 * 60);
      if (ageMin < 15) {
        status = "ok";
        reason = `Last Gmail event ${Math.round(ageMin)} min ago.`;
      } else if (ageMin < 60) {
        status = "warn";
        reason = `Last Gmail event ${Math.round(ageMin)} min ago.`;
      } else {
        status = "broken";
        reason = `Last Gmail event ${Math.round(ageMin / 60)}h ago — sync stalled.`;
      }
    }
    stages.push({
      id: "gmail-sync",
      label: "Gmail sync",
      hint: "Pulls sent / replies / bounces into contact_events.",
      launchdLabel: "com.forgecapital.gmail-sync",
      cadence: "Not yet deployed (planned: every 10 min)",
      count: events,
      countLabel: "contact events ingested",
      countSource: "COUNT(*) FROM public.contact_events",
      lastRunAt: latest?.toISOString() ?? null,
      lastRunSource: latest
        ? "MAX(event_at) on public.contact_events"
        : "No rows — table is empty",
      status,
      statusReason: reason,
    });
  }

  // ----- 8. Send (outreach) ----------------------------------------
  {
    const sent = sentEvents < 0 ? 0 : sentEvents;
    // Freshness comes from latestEvent filtered by outbound, but that
    // would be an extra query; use total-event latest as a proxy. Safe
    // because today there is 0 of both.
    const latest = latestEvent ? new Date(latestEvent) : null;
    const { status, reason } = classify(
      latest,
      "outbound Gmail event",
    );
    stages.push({
      id: "send",
      label: "Send",
      hint: "Outbound emails — Gmail send + logged as direction='outbound'.",
      launchdLabel: "com.fractionalforge.send-outreach",
      cadence: "Weekdays, hourly 09–17",
      count: sent,
      countLabel: "outbound events logged",
      countSource: "COUNT(*) WHERE direction = 'outbound'",
      lastRunAt: latest?.toISOString() ?? null,
      lastRunSource: latest
        ? "MAX(event_at) on contact_events"
        : "No rows — Gmail sync has not landed yet",
      status,
      statusReason:
        sent === 0
          ? "No sends recorded — will populate once Gmail sync ingests the Sent folder."
          : reason,
    });
  }

  // ----- 9. Parse reply --------------------------------------------
  {
    const replies = replyEvents < 0 ? 0 : replyEvents;
    const latest = latestEvent ? new Date(latestEvent) : null;
    const { status, reason } = classify(latest, "inbound Gmail event");
    stages.push({
      id: "parse-reply",
      label: "Parse reply",
      hint: "Inbound replies — classify OOO / bounce / real / auto.",
      launchdLabel: "com.forgecapital.gmail-sync",
      cadence: "Bundled with Gmail sync",
      count: replies,
      countLabel: "inbound events logged",
      countSource: "COUNT(*) WHERE direction = 'inbound'",
      lastRunAt: latest?.toISOString() ?? null,
      lastRunSource: latest
        ? "MAX(event_at) on contact_events"
        : "No rows — Gmail sync has not landed yet",
      status,
      statusReason:
        replies === 0
          ? "No replies recorded — will populate once Gmail sync ingests the Inbox."
          : reason,
    });
  }

  return {
    stages,
    enrichment7d,
    huntQueuePending: huntPending < 0 ? 0 : huntPending,
    lastBatchAt: lastBatch?.toISOString() ?? null,
    // Fixed from com.forgecapital.full-pipeline plist: daily 06:00.
    nextScheduledAt: "Daily 06:00",
    fsProbeAvailable:
      discoverMtime !== null ||
      pushMtime !== null ||
      reverifyMtime !== null ||
      pipelineMtime !== null ||
      weeklyMtime !== null,
  };
}

/* -------------------------------------------------------------------
   Small query helpers — kept private to the module
   ------------------------------------------------------------------- */

async function fetchMaxSynthesizedAt(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("investors_mirror")
    .select("synthesized_at")
    .not("synthesized_at", "is", null)
    .order("synthesized_at", { ascending: false })
    .limit(1);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[pipeline-health] MAX(synthesized_at) failed:", error.message);
    return null;
  }
  const first = data?.[0]?.synthesized_at as string | null | undefined;
  return first ?? null;
}

async function fetchMaxEventAt(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("contact_events")
    .select("event_at")
    .order("event_at", { ascending: false })
    .limit(1);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[pipeline-health] MAX(event_at) failed:", error.message);
    return null;
  }
  const first = data?.[0]?.event_at as string | null | undefined;
  return first ?? null;
}

/**
 * Per-day histogram of synthesised rows over the last 7 days (inclusive
 * of today). synthesized_at is stored as text (per migration 008), so
 * we pull the last 2000 rows and bucket them client-side rather than
 * fight with postgres text-vs-timestamp comparisons.
 */
async function fetchEnrichment7d(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<EnrichmentDay[]> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("investors_mirror")
    .select("synthesized_at")
    .not("synthesized_at", "is", null)
    .gte("synthesized_at", start.toISOString())
    .limit(5000);

  // Seed the 7 daily buckets so we always return exactly 7 points.
  const buckets = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    buckets.set(isoDay(d), 0);
  }

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[pipeline-health] enrichment-7d failed:", error.message);
  } else {
    for (const row of data ?? []) {
      const raw = (row as { synthesized_at: string | null }).synthesized_at;
      if (!raw) continue;
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) continue;
      const key = isoDay(d);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
