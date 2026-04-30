import {
  getPipelineHealth,
  type EnrichmentDay,
  type PipelineStage,
  type StageStatus,
} from "@/lib/queries/pipeline-health";
import { SyncNowButton } from "./SyncNowButton";

/**
 * Automation pipeline — honest-state dashboard.
 *
 * The real "pipeline" isn't a page of buttons the web app drives; it's
 * nine launchd agents on Tristan's Mac (discover → enrich → synthesise
 * → push → email-verify → email-hunt-queue → gmail-sync → send →
 * parse-reply). This page is a read-only dashboard reflecting where
 * each stage stands right now.
 *
 * Numbers come from Supabase (COUNT queries against the mirror tables).
 * Freshness comes from two sources: Supabase MAX-timestamps (always
 * available) and filesystem mtimes of the cron log files (only on
 * localhost — Vercel has no access to ~/.forge-capital/*.log).
 *
 * There are no action buttons. The cron is owned by launchd, not the
 * web app. Anything that looks like a CTA would be a lie — so none
 * are rendered.
 *
 * Force dynamic: health changes minute-to-minute; we refuse to cache.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function PipelinePage(_props: {
  searchParams?: SearchParams;
  // Present so the /home composer can pass them without type error; this
  // dashboard doesn't scope by campaign (it reflects cross-campaign
  // cron health). Kept in the signature for composition-safety only.
  initialCampaigns?: unknown;
  initialCampaignId?: unknown;
} = {}) {
  const health = await getPipelineHealth();

  const okCount = health.stages.filter((s) => s.status === "ok").length;
  const warnCount = health.stages.filter((s) => s.status === "warn").length;
  const brokenCount = health.stages.filter((s) => s.status === "broken").length;

  const headerChipClass =
    brokenCount > 0
      ? "evidence-chip red"
      : warnCount > 0
        ? "evidence-chip pending"
        : "evidence-chip";

  const headerChipText =
    brokenCount > 0
      ? `${brokenCount} stage${brokenCount === 1 ? "" : "s"} broken`
      : warnCount > 0
        ? `${warnCount} stage${warnCount === 1 ? "" : "s"} warn`
        : `${okCount} / ${health.stages.length} stages healthy`;

  return (
    <section id="automation" className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">
            Automation pipeline <span className="new-tag">LIVE</span>
          </div>
          <div className="section-sub">
            Nine launchd agents run the Forge Capital pipeline on
            Tristan&rsquo;s Mac. This page is a read-only dashboard — it
            reads Supabase + the local cron logs to show where each stage
            stands. No buttons: the cron is owned by launchd, not the
            web app.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span
            className={headerChipClass}
            title="Aggregate health across all nine stages."
          >
            <span className="dot" />
            {headerChipText}
          </span>
          <SyncNowButton />
        </div>
      </div>

      {/* Last batch / next scheduled — pulled from launchd log mtime. */}
      <div
        className="pipe-summary"
        style={{
          marginTop: 0,
          marginBottom: 14,
          paddingTop: 0,
          borderTop: "none",
        }}
      >
        <span>
          Last full-pipeline run:{" "}
          <b>{formatLongTs(health.lastBatchAt)}</b>
        </span>
        <span>&middot;</span>
        <span>
          Next scheduled:{" "}
          <b>{health.nextScheduledAt}</b>{" "}
          <span style={{ color: "var(--text-faint)" }}>
            (com.forgecapital.full-pipeline)
          </span>
        </span>
        {!health.fsProbeAvailable ? (
          <span
            style={{ color: "var(--amber)" }}
            title="This dashboard is running on a server with no access to ~/.forge-capital/*.log — all freshness chips fall back to Supabase-visible timestamps."
          >
            &middot; cron log mtimes unavailable (Supabase-only fallback)
          </span>
        ) : null}
      </div>

      {/* Two-column layout: vertical stepper on the left, side-cards on
          the right. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <ol
          className="ms-stepper"
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "8px 14px",
            background: "var(--surface)",
          }}
        >
          {health.stages.map((stage, idx) => (
            <StageRow
              key={stage.id}
              stage={stage}
              isLast={idx === health.stages.length - 1}
            />
          ))}
        </ol>

        <div style={{ display: "grid", gap: 12 }}>
          <EnrichmentCard days={health.enrichment7d} />
          <QueueCard
            pending={health.huntQueuePending}
            stage={
              health.stages.find((s) => s.id === "email-hunt-queue") ?? null
            }
          />
          <GmailCard
            stage={health.stages.find((s) => s.id === "gmail-sync") ?? null}
          />
        </div>
      </div>

      <div className="walk-callout">
        <span className="wc-num">!</span>
        <b>Honest by design.</b> Every number comes from a Supabase count or
        a log-file mtime — never from a hand-coded constant. If a stage
        says &ldquo;broken&rdquo; the cron genuinely has not reported in for
        &gt; 72h. If a stage says &ldquo;warn&rdquo; and its count is zero,
        the underlying feature isn&rsquo;t deployed yet — not that the
        cron failed.
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------
   Stepper row — one stage
   ------------------------------------------------------------------- */

function StageRow({ stage, isLast }: { stage: PipelineStage; isLast: boolean }) {
  // Bullet styling: ok → done (green tick), warn → active (accent ring),
  // broken → red ring.
  const bulletClass =
    stage.status === "ok"
      ? "ms-step done"
      : stage.status === "broken"
        ? "ms-step active"
        : "ms-step active";

  const bulletStyle: React.CSSProperties =
    stage.status === "broken"
      ? {
          background: "var(--red)",
          boxShadow: "0 0 0 3px var(--red-light)",
        }
      : stage.status === "warn"
        ? {
            background: "var(--amber)",
            boxShadow: "0 0 0 3px var(--amber-light)",
          }
        : {};

  const rowBorder: React.CSSProperties = isLast
    ? {}
    : { borderBottom: "1px solid var(--border-soft)" };

  return (
    <li
      className={bulletClass}
      style={{
        gap: 12,
        padding: "12px 0",
        alignItems: "flex-start",
        ...rowBorder,
      }}
    >
      <span
        className="bullet"
        style={{
          marginTop: 3,
          width: 18,
          height: 18,
          fontSize: 10,
          ...bulletStyle,
        }}
        title={stage.statusReason}
      >
        {stage.status === "ok" ? "✓" : stage.status === "broken" ? "!" : ""}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "baseline",
          }}
        >
          <div>
            {/* Deliberately NOT using className="label" — V4's
                `.ms-step.done .label` applies a strikethrough that
                would make healthy stages look dead. */}
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              {stage.label}
            </span>
            {stage.launchdLabel ? (
              <span
                style={{
                  marginLeft: 8,
                  color: "var(--text-faint)",
                  fontSize: 10,
                  fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
                }}
                title="launchd plist label"
              >
                {stage.launchdLabel}
              </span>
            ) : null}
          </div>
          <StatusChip status={stage.status} reason={stage.statusReason} />
        </div>

        <div
          className="meta"
          style={{
            marginTop: 4,
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
          {stage.hint}
        </div>

        <div
          className="ms-kv"
          style={{ padding: "6px 0 0 0", fontSize: 12 }}
          title={stage.countSource}
        >
          <span className="k">{stage.countLabel}</span>
          <span className="v">{formatCount(stage.count)}</span>
        </div>

        <div
          className="ms-kv"
          style={{ padding: "2px 0", fontSize: 11 }}
          title={stage.lastRunSource}
        >
          <span className="k">Last run</span>
          <span className="v" style={{ fontWeight: 400 }}>
            {formatRelative(stage.lastRunAt)}{" "}
            <span style={{ color: "var(--text-faint)" }}>
              &middot; {formatShortTs(stage.lastRunAt)}
            </span>
          </span>
        </div>

        <div className="ms-kv" style={{ padding: "2px 0", fontSize: 11 }}>
          <span className="k">Cadence</span>
          <span className="v" style={{ fontWeight: 400 }}>
            {stage.cadence ?? "—"}
          </span>
        </div>
      </div>
    </li>
  );
}

function StatusChip({
  status,
  reason,
}: {
  status: StageStatus;
  reason: string;
}) {
  const className =
    status === "ok"
      ? "evidence-chip"
      : status === "warn"
        ? "evidence-chip pending"
        : "evidence-chip red";
  const label =
    status === "ok" ? "ok" : status === "warn" ? "warn" : "broken";
  return (
    <span className={className} title={reason}>
      <span className="dot" />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------
   Sidebar cards
   ------------------------------------------------------------------- */

function EnrichmentCard({ days }: { days: EnrichmentDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="ms-card">
      <h4>Enrichment · last 7 days</h4>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          height: 64,
          marginBottom: 6,
        }}
        title="Rows with a fresh synthesized_at per day, from public.investors_mirror."
      >
        {days.map((d) => {
          const heightPct = Math.round((d.count / max) * 100);
          return (
            <div
              key={d.day}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                height: "100%",
              }}
              title={`${d.day} · ${d.count} synthesised`}
            >
              <div
                style={{
                  height: `${Math.max(2, heightPct)}%`,
                  background: d.count === 0 ? "var(--border)" : "var(--accent)",
                  borderRadius: 3,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        className="ms-kv"
        style={{ padding: "2px 0", fontSize: 11 }}
      >
        <span className="k">Total this week</span>
        <span className="v">{formatCount(total)} rows</span>
      </div>
      <div
        className="ms-kv"
        style={{ padding: "2px 0", fontSize: 11 }}
      >
        <span className="k">Busiest day</span>
        <span className="v">
          {busiest(days)}
        </span>
      </div>
    </div>
  );
}

function QueueCard({
  pending,
  stage,
}: {
  pending: number;
  stage: PipelineStage | null;
}) {
  return (
    <div className="ms-card">
      <h4>Email hunt queue</h4>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color:
            pending === 0
              ? "var(--text-faint)"
              : pending > 25
                ? "var(--amber)"
                : "var(--accent)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        {pending}
      </div>
      <div
        style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}
      >
        pending partners waiting for Hunter
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
          lineHeight: 1.4,
        }}
        title={stage?.statusReason}
      >
        {stage?.statusReason ??
          "Users queue rows via Find-a-Match → Resolve email. The nightly pipeline drains them."}
      </div>
    </div>
  );
}

function GmailCard({ stage }: { stage: PipelineStage | null }) {
  // count === 0 means no events ingested yet — the cron IS deployed (vercel.json,
  // every 15 min). The old label "not yet deployed" was a false positive.
  const noEventsYet = (stage?.count ?? 0) === 0;
  return (
    <div className="ms-card">
      <h4>Gmail sync</h4>
      {noEventsYet ? (
        <>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            No events ingested yet
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-faint)",
              lineHeight: 1.5,
            }}
          >
            The cron runs every 15 minutes. Events will appear here once
            the Gmail sync ingests messages to or from your campaign
            partners. Use &ldquo;Sync now&rdquo; to trigger a manual run.
          </div>
        </>
      ) : (
        <>
          <div
            className="ms-kv"
            style={{ padding: "2px 0", fontSize: 11 }}
          >
            <span className="k">Events ingested</span>
            <span className="v">{formatCount(stage?.count ?? 0)}</span>
          </div>
          <div
            className="ms-kv"
            style={{ padding: "2px 0", fontSize: 11 }}
          >
            <span className="k">Latest</span>
            <span className="v">
              {formatRelative(stage?.lastRunAt ?? null)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------
   Format helpers
   ------------------------------------------------------------------- */

function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / (1000 * 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatShortTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function formatLongTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return formatShortTs(iso);
}

function busiest(days: EnrichmentDay[]): string {
  if (days.length === 0) return "—";
  const sorted = [...days].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  if (!top || top.count === 0) return "no activity";
  return `${top.day.slice(5)} · ${formatCount(top.count)} rows`;
}
