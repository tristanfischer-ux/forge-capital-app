import Link from "next/link";
import type {
  TrackerActionPanelData,
  TrackerRecentEvent,
  TrackerAttentionRow,
} from "@/lib/queries/tracker-action-panel";
import { relativeTimeLabel } from "@/lib/queries/tracker-action-panel";
import { labelFor } from "@/lib/status-codes";

/**
 * Tracker "Next-step" action panel — UX audit 2026-04-23 item #7.
 *
 * Replaces the old status-distribution chart + stat-tile strip that
 * occupied the top of /tracker with three DECISION-ORIENTED surfaces:
 *
 *   (1) Next step — how many rows sit at +0 Pending approval + primary
 *       CTA to generate the approval sheet for the active campaign.
 *   (2) Recent activity — last 5 contact_events for the campaign,
 *       newest first. Shows firm + event_type + relative time so the
 *       founder sees the pulse of the campaign without opening Gmail.
 *   (3) Needs attention — rows at +6 (response received, no follow-up
 *       in >5 days), +7 (meeting offered, no inbound in >3 days), or
 *       +10 (NDA/diligence idle >14 days). Each links to the partner
 *       profile so the founder can act immediately.
 *
 * The old status distribution strip (StatusSummary) moves to the
 * bottom of the tracker page as a small informational widget — see
 * tracker/page.tsx.
 *
 * V4 class names are reused where they fit (`.section-head`, `.wk-stat`
 * for the top-level count tile, `.walk-callout` for the dashed footer).
 * Plain utility classes fill the rest since V4 has no direct analogue
 * for a multi-column action panel.
 */

export function TrackerActionPanel({
  campaignId,
  data,
}: {
  campaignId: string;
  data: TrackerActionPanelData;
}) {
  return (
    <div
      className="rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]"
      style={{ marginBottom: 16 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
          gap: 14,
        }}
      >
        <NextStepCell
          campaignId={campaignId}
          pendingApprovalCount={data.pendingApprovalCount}
        />
        <RecentActivityCell events={data.recentEvents} />
        <NeedsAttentionCell rows={data.needsAttention} />
      </div>
    </div>
  );
}

/* --------------------------- 1. NEXT STEP ------------------------------- */

function NextStepCell({
  campaignId,
  pendingApprovalCount,
}: {
  campaignId: string;
  pendingApprovalCount: number;
}) {
  return (
    <section
      aria-label="Next step"
      style={{
        borderRight: "1px solid var(--border-soft)",
        paddingRight: 14,
      }}
    >
      <Header title="Next step" />
      {pendingApprovalCount > 0 ? (
        <>
          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
            {pendingApprovalCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            row{pendingApprovalCount === 1 ? "" : "s"} at{" "}
            <code
              style={{
                fontFamily: "'SF Mono', monospace",
                fontSize: 11,
                background: "var(--surface-alt)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              +0
            </code>{" "}
            Pending approval
          </div>
          <Link
            href={`/approval/sheet/${campaignId}`}
            className="ic-btn"
            style={{
              marginTop: 12,
              display: "inline-flex",
              background: "var(--accent-2)",
              textDecoration: "none",
            }}
          >
            Generate approval sheet &rarr;
          </Link>
        </>
      ) : (
        <EmptyCell>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            Nothing at{" "}
            <code
              style={{
                fontFamily: "'SF Mono', monospace",
                fontSize: 11,
                background: "var(--surface-alt)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              +0
            </code>
            .
          </div>
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Shortlist investors on Find a Match to queue them for
            approval. The queue populates here once rows land at{" "}
            <code style={{ fontFamily: "'SF Mono', monospace", fontSize: 11 }}>+0</code>.
          </p>
        </EmptyCell>
      )}
    </section>
  );
}

/* ------------------------ 2. RECENT ACTIVITY ---------------------------- */

function RecentActivityCell({ events }: { events: TrackerRecentEvent[] }) {
  return (
    <section
      aria-label="Recent activity"
      style={{
        borderRight: "1px solid var(--border-soft)",
        paddingRight: 14,
      }}
    >
      <Header title="Recent activity" />
      {events.length === 0 ? (
        <EmptyCell>
          <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            No contact events recorded yet. The Gmail sync daemon
            populates inbound / outbound events once it runs, and the
            last 5 land here newest-first.
          </p>
        </EmptyCell>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((ev) => (
            <li
              key={`${ev.campaign_partner_id}-${ev.event_at}`}
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                borderBottom: "1px dashed var(--border-soft)",
                paddingBottom: 7,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>
                  {ev.firm_name ?? "(unknown firm)"}
                </span>
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                  {relativeTimeLabel(ev.event_at)}
                </span>
              </div>
              <div style={{ color: "var(--text-dim)", marginTop: 2 }}>
                {humaniseEventType(ev.event_type, ev.direction)}
                {ev.partner_name ? (
                  <>
                    {" "}
                    &middot;{" "}
                    <span style={{ color: "var(--text-faint)" }}>
                      {ev.partner_name}
                    </span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------ 3. NEEDS ATTENTION ---------------------------- */

function NeedsAttentionCell({ rows }: { rows: TrackerAttentionRow[] }) {
  return (
    <section aria-label="Needs attention">
      <Header title="Needs attention" />
      {rows.length === 0 ? (
        <EmptyCell>
          <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Nothing stuck. Rows re-surface here when a response has been
            idle &gt; 5 days at{" "}
            <code style={{ fontFamily: "'SF Mono', monospace", fontSize: 11 }}>+6</code>,
            a meeting offer &gt; 3 days at{" "}
            <code style={{ fontFamily: "'SF Mono', monospace", fontSize: 11 }}>+7</code>,
            or diligence &gt; 14 days at{" "}
            <code style={{ fontFamily: "'SF Mono', monospace", fontSize: 11 }}>+10</code>.
          </p>
        </EmptyCell>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.slice(0, 5).map((r) => {
            const label = labelFor(r.status_code) ?? r.status_code;
            const href = r.partner_id
              ? `/partner/${r.partner_id}`
              : `/tracker/${r.campaign_partner_id}/draft`;
            return (
              <li
                key={r.campaign_partner_id}
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  borderBottom: "1px dashed var(--border-soft)",
                  paddingBottom: 7,
                }}
              >
                <Link
                  href={href}
                  style={{
                    color: "var(--text)",
                    textDecoration: "none",
                    display: "block",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600 }}>
                      {r.firm_name ?? "(unknown firm)"}
                    </span>
                    <span
                      style={{
                        color: "var(--amber)",
                        fontSize: 11,
                        fontFamily: "'SF Mono', monospace",
                      }}
                    >
                      {r.status_code} {label}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-dim)", marginTop: 2 }}>
                    {r.reason}
                  </div>
                </Link>
              </li>
            );
          })}
          {rows.length > 5 ? (
            <li style={{ fontSize: 11, color: "var(--text-faint)" }}>
              +{rows.length - 5} more — sorted by longest idle first.
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Header({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 8,
      }}
    >
      {title}
    </div>
  );
}

function EmptyCell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--surface-alt)",
        border: "1px dashed var(--border)",
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Humanise contact_events.event_type (snake_case strings produced by
 * the Python pipeline + Gmail sync daemon) into the short label the
 * founder recognises. Unknown event types render verbatim so we never
 * hide an event — the pipeline is the source of truth.
 */
function humaniseEventType(
  eventType: string | null,
  direction: string | null,
): string {
  if (!eventType) {
    return direction === "inbound"
      ? "inbound email"
      : direction === "outbound"
        ? "outbound email"
        : "contact event";
  }
  const map: Record<string, string> = {
    outbound_first_contact: "outbound — first contact",
    outbound_follow_up: "outbound — follow-up",
    outbound_reply: "outbound — reply",
    test_send: "test send (dry run)",
    reply: "reply received",
    approver_reply: "approver reply",
    meeting_scheduled: "meeting scheduled",
    meeting_held: "meeting held",
    call_logged: "call logged",
    note_logged: "note logged",
    bounced: "bounced",
    opened: "opened",
  };
  const label = map[eventType];
  if (label) return label;
  // Fall back to the raw type with underscores flipped to spaces so
  // novel event types still render as readable English.
  return eventType.replace(/_/g, " ");
}
