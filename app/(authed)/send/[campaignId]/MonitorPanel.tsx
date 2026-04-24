"use client";

import Link from "next/link";
import type {
  CampaignMonitorData,
  CampaignMonitorEvent,
} from "@/lib/queries/monitor";

/**
 * Step 10 Monitor tile for the /send/[campaignId] flow. After the
 * founder queues sends in Step 9 this panel answers "what actually
 * happened?" — how many went out, how many are still pending, how
 * many failed, how many bounced, and who replied this week.
 *
 * Styling follows the SendFlow + V4 vocabulary (var(--accent),
 * var(--border), var(--surface), var(--text-dim), var(--text-faint)).
 * No Tailwind approximations — per CLAUDE.md the class names are
 * already live in production via app/v4-mockup.css.
 */

interface MonitorPanelProps {
  data: CampaignMonitorData;
  campaignId: string;
}

export function MonitorPanel({ data, campaignId }: MonitorPanelProps) {
  const { counts, recent } = data;

  const totalCount =
    counts.sent +
    counts.queued +
    counts.dispatching +
    counts.failed +
    counts.cancelled +
    counts.inbound_replies_7d +
    counts.bounces_7d;
  const nothingDispatched = totalCount === 0 && recent.length === 0;

  return (
    <div
      style={{
        marginTop: 18,
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              color: "var(--text-faint)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Step 10 · Monitor
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            Dispatch status
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 2,
            }}
          >
            Live counts from the scheduled-send dispatcher plus inbound
            replies and bounces from the last 7 days.
          </div>
        </div>
        <Link
          href={`/approval/scheduled?c=${campaignId}`}
          style={{
            fontSize: 12,
            color: "var(--accent)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          Full queue →
        </Link>
      </div>

      {nothingDispatched ? (
        <EmptyMonitor />
      ) : (
        <>
          <StatGrid counts={counts} />
          <RecentList recent={recent} />
        </>
      )}

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px dashed var(--border)",
          fontSize: 11,
          color: "var(--text-faint)",
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>
          Scheduled dispatcher polls every 60s · bounces detected via
          Gmail delivery-status notifications
        </span>
        <Link
          href={`/approval/scheduled?c=${campaignId}`}
          style={{ color: "var(--text-dim)", textDecoration: "underline" }}
        >
          View scheduled sends queue
        </Link>
      </div>
    </div>
  );
}

// ── Stat grid ────────────────────────────────────────────────────────

type TileTone = "good" | "warn" | "bad" | "info" | "neutral";

function StatGrid({ counts }: { counts: CampaignMonitorData["counts"] }) {
  const tiles: Array<{
    key: string;
    count: number;
    label: string;
    tone: TileTone;
  }> = [
    { key: "sent", count: counts.sent, label: "Sent", tone: "good" },
    { key: "queued", count: counts.queued, label: "Queued", tone: "warn" },
    {
      key: "dispatching",
      count: counts.dispatching,
      label: "Dispatching",
      tone: "neutral",
    },
    { key: "failed", count: counts.failed, label: "Failed", tone: "bad" },
    {
      key: "cancelled",
      count: counts.cancelled,
      label: "Cancelled",
      tone: "neutral",
    },
    {
      key: "replies",
      count: counts.inbound_replies_7d,
      label: "Replies · 7d",
      tone: "info",
    },
    {
      key: "bounces",
      count: counts.bounces_7d,
      label: "Bounces · 7d",
      tone: "bad",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: 8,
        marginBottom: 16,
      }}
    >
      {tiles.map((t) => (
        <StatTile
          key={t.key}
          count={t.count}
          label={t.label}
          tone={t.tone}
        />
      ))}
    </div>
  );
}

function StatTile({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: TileTone;
}) {
  const palette = toneToPalette(tone, count);

  return (
    <div
      style={{
        padding: "10px 12px",
        border: `1px solid ${palette.border}`,
        background: palette.background,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 58,
      }}
    >
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.1,
          color: palette.countColor,
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-faint)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Map a tone + count to a palette. Tiles with a zero count render in
 * the neutral family regardless of tone — green "Sent: 0" is
 * misleading, and red "Failed: 0" looks alarming when nothing's gone
 * wrong. Only non-zero counts get the coloured accent.
 */
function toneToPalette(
  tone: TileTone,
  count: number,
): {
  border: string;
  background: string;
  countColor: string;
} {
  if (count === 0) {
    return {
      border: "var(--border)",
      background: "var(--surface)",
      countColor: "var(--text-faint)",
    };
  }
  switch (tone) {
    case "good":
      return {
        border: "#b6e3c6",
        background: "#f1faf4",
        countColor: "#1f7a45",
      };
    case "warn":
      return {
        border: "#f0d79a",
        background: "#fdf6e7",
        countColor: "#a16207",
      };
    case "bad":
      return {
        border: "#f0b9b9",
        background: "#fdf1f1",
        countColor: "#b91c1c",
      };
    case "info":
      return {
        border: "#b9d4f0",
        background: "#f1f6fd",
        countColor: "#1d4ed8",
      };
    default:
      return {
        border: "var(--border)",
        background: "var(--surface-alt, var(--surface))",
        countColor: "var(--text)",
      };
  }
}

// ── Recent activity list ─────────────────────────────────────────────

function RecentList({ recent }: { recent: CampaignMonitorEvent[] }) {
  if (recent.length === 0) {
    return (
      <div
        style={{
          padding: 14,
          border: "1px dashed var(--border)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--text-dim)",
          background: "var(--surface)",
        }}
      >
        No recent events — sends will appear here the moment the
        dispatcher hands them to Gmail.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--text-faint)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Recent activity
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {recent.map((event, idx) => (
          <RecentRow key={`${event.campaign_partner_id}-${event.kind}-${event.at}-${idx}`} event={event} />
        ))}
      </div>
    </div>
  );
}

function RecentRow({ event }: { event: CampaignMonitorEvent }) {
  const badge = kindBadge(event.kind);
  const detail = rowDetail(event);
  const who = [event.firm_name, event.partner_name].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "78px 1fr auto",
        alignItems: "baseline",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 700,
          color: badge.color,
          background: badge.background,
          border: `1px solid ${badge.border}`,
          padding: "2px 6px",
          borderRadius: 4,
          textAlign: "center",
          justifySelf: "start",
          alignSelf: "center",
        }}
      >
        {badge.label}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {who || "Unknown partner"}
          {event.partner_title ? (
            <span
              style={{
                fontWeight: 400,
                color: "var(--text-dim)",
                marginLeft: 6,
              }}
            >
              · {event.partner_title}
            </span>
          ) : null}
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={detail}
          >
            {truncate(detail, 120)}
          </div>
        ) : null}
      </div>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-faint)",
          whiteSpace: "nowrap",
        }}
      >
        {formatBritishTimestamp(event.at)}
      </span>
    </div>
  );
}

function kindBadge(kind: CampaignMonitorEvent["kind"]): {
  label: string;
  color: string;
  background: string;
  border: string;
} {
  switch (kind) {
    case "send":
      return {
        label: "Sent",
        color: "#1f7a45",
        background: "#f1faf4",
        border: "#b6e3c6",
      };
    case "failed":
      return {
        label: "Failed",
        color: "#b91c1c",
        background: "#fdf1f1",
        border: "#f0b9b9",
      };
    case "reply":
      return {
        label: "Reply",
        color: "#1d4ed8",
        background: "#f1f6fd",
        border: "#b9d4f0",
      };
    case "bounce":
      return {
        label: "Bounce",
        color: "#b91c1c",
        background: "#fdf1f1",
        border: "#f0b9b9",
      };
  }
}

function rowDetail(event: CampaignMonitorEvent): string | null {
  if (event.kind === "send") return event.subject;
  if (event.kind === "failed") return event.error_message ?? event.subject;
  if (event.kind === "reply") return event.summary;
  if (event.kind === "bounce") return event.summary;
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * "14 Apr · 09:23" — British short-month + zero-padded 24-hour clock.
 * Rendered client-side so the timestamp matches the viewer's local
 * time zone, which is what founders actually want when they're
 * eyeballing "was this sent in Nordics morning?".
 */
function formatBritishTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} · ${hh}:${mm}`;
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyMonitor() {
  return (
    <div
      style={{
        padding: 24,
        border: "1px dashed var(--border)",
        borderRadius: 8,
        textAlign: "center",
        fontSize: 13,
        color: "var(--text-dim)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: 4,
        }}
      >
        Nothing dispatched yet
      </div>
      <div>
        Complete Step 9 to queue sends — the monitor populates as the
        dispatcher works through the queue.
      </div>
    </div>
  );
}
