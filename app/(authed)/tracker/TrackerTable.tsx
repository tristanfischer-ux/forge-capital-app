"use client";

import { Fragment, useMemo, useState } from "react";
import type { TrackerRow } from "@/lib/queries/tracker";
import { StatusBadge } from "./StatusBadge";
import { TrackerRowDrawer } from "./TrackerRowDrawer";

/**
 * Tracker grid — V4 §2 "Tracker — master sheet preview" re-port
 * (Phase2-Mockup-V4.html lines 1798–1869). Uses V4's `.approval-col`
 * wrapper + `.sheet-head-strip` + `.sheet` table classes directly so
 * parity is by construction. The expand-row drawer (status edit,
 * commentary log, draft preview link) from `TrackerRowDrawer.tsx` is
 * preserved — clicking a row toggles the drawer below it.
 *
 * V4 columns (1:1): Firm · Contact | Status | Days since | Commentary.
 * Commentary renders as a chronological string with `[YYYY-MM-DD]`
 * date chips (V4 `.comment-af .dt`). When we only have the coarse
 * company_summary + why-them we render those instead of a date-chipped
 * chronology, since the V1 data layer doesn't persist per-event entries.
 *
 * Client component because sort + expand are local-state interactions.
 * V1 is read-only for status edits (those live in the drawer).
 */

type SortKey = "status" | "days" | "firm";
type SortDir = "asc" | "desc";

/**
 * Sort weight per status code. Late-stage codes sort highest when desc,
 * declined/disqualified lowest. Unknown codes sink to the bottom.
 */
const STATUS_SORT_WEIGHT: Record<string, number> = {
  "+12": 112,
  "+11": 111,
  "+10": 110,
  "+9": 109,
  "+8": 108,
  "+7": 107,
  "+6": 106,
  "+5": 105,
  "+4": 104,
  "+3": 103,
  "+2": 102,
  "+1": 101,
  "+0": 100,
  "-1": 10,
  "-2": 9,
  "-3": 8,
};

function sortRows(rows: TrackerRow[], key: SortKey, dir: SortDir): TrackerRow[] {
  const signed = dir === "asc" ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "status": {
        const aw = a.status_code ? (STATUS_SORT_WEIGHT[a.status_code] ?? 0) : -1;
        const bw = b.status_code ? (STATUS_SORT_WEIGHT[b.status_code] ?? 0) : -1;
        cmp = aw - bw;
        break;
      }
      case "days": {
        // Null days (never contacted) sink on desc, rise on asc.
        const aw = a.days_since_last_contact ?? -1;
        const bw = b.days_since_last_contact ?? -1;
        cmp = aw - bw;
        break;
      }
      case "firm": {
        const aw = (a.firm_name ?? "").toLowerCase();
        const bw = (b.firm_name ?? "").toLowerCase();
        cmp = aw.localeCompare(bw);
        break;
      }
    }
    return cmp * signed;
  });
  return copy;
}

function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "0d";
  return `${days}d`;
}

/**
 * Human-relative last-touched. "never" when no contact_events exist for
 * the partner. Uses the same day-bucket maths as days_since_last_contact
 * but reads from `last_event_at` (contact_events-sourced) rather than
 * `last_contact_at` (campaign_partners-sourced) so the freshness reflects
 * the actual email traffic, not a manual status-edit bump.
 */
function formatLastTouched(iso: string | null): string {
  if (!iso) return "never";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(0, Math.floor((now - then) / msPerDay));
  if (days === 0) {
    const hours = Math.max(0, Math.floor((now - then) / (1000 * 60 * 60)));
    if (hours === 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/** Truncate a subject line to ~60 chars with an ellipsis. */
function truncateSubject(s: string | null, max = 60): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

/**
 * Simple relative timestamp for the sheet-head-strip "last synced X"
 * meta line. V4 hard-codes "2 min ago"; in production we render the
 * real time since the last tracker row was last_contact_at. When all
 * rows lack a last-contact timestamp, fall back to "—".
 */
function formatRelativeSync(rows: TrackerRow[]): string {
  const mostRecent = rows
    .map((r) => r.days_since_last_contact)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];
  if (mostRecent === undefined) return "never";
  if (mostRecent === 0) return "today";
  if (mostRecent === 1) return "yesterday";
  return `${mostRecent}d ago`;
}

export function TrackerTable({
  rows,
  campaignName,
  counterpartName,
}: {
  rows: TrackerRow[];
  campaignName?: string;
  /** Counterpart display name for the "(X view)" subtitle. Empty string
   *  or undefined omits the parenthetical — no more hardcoded Stephan. */
  counterpartName?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  const syncedLabel = useMemo(() => formatRelativeSync(rows), [rows]);

  function onSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "firm" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return (
      <span style={{ marginLeft: 4, fontSize: 9, color: "var(--text-faint)" }}>
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  }

  const rowLabel = rows.length === 1 ? "row" : "rows";

  return (
    <div className="approval-col" style={{ overflow: "hidden" }}>
      {/* Sheet head strip — V4 `.sheet-head-strip` (line 1809) */}
      <div className="sheet-head-strip">
        <div className="sh-left">
          <span className="sh-title">
            {campaignName
              ? `${campaignName} · master tracker${counterpartName ? ` (${counterpartName} view)` : ""}`
              : `Master tracker${counterpartName ? ` (${counterpartName} view)` : ""}`}
          </span>
          <span className="sh-meta">
            · {rows.length} {rowLabel} · last synced {syncedLabel}
          </span>
        </div>
        <div className="sh-right">
          <span className="evidence-chip">
            <span className="dot"></span>
            Status vocabulary locked to the 16-code Legend sheet
          </span>
        </div>
      </div>

      {/* Results table — V4 `table.sheet` (line 1818). Columns (L→R):
          Firm · Contact · Status · Days since · Emails · Commentary.
          Emails column carries in/out counts, human-relative last-touched,
          and the latest subject truncated to 60 chars. Populates when the
          Gmail sync daemon lands — until then every row reads "no email
          traffic yet" (faint). */}
      <table className="sheet">
        <thead>
          <tr>
            <th
              style={{ width: "22%", cursor: "pointer" }}
              onClick={() => onSort("firm")}
            >
              Firm · Contact{sortIndicator("firm")}
            </th>
            <th
              style={{ width: "16%", cursor: "pointer" }}
              onClick={() => onSort("status")}
            >
              Status{sortIndicator("status")}
            </th>
            <th
              style={{ width: "7%", cursor: "pointer" }}
              onClick={() => onSort("days")}
            >
              Days since{sortIndicator("days")}
            </th>
            <th style={{ width: "20%" }}>Emails</th>
            <th>Commentary (chronological, ` | ` separated)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <Fragment key={row.id}>
                <tr
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setExpandedId((current) =>
                      current === row.id ? null : row.id,
                    )
                  }
                >
                  <td>
                    <div className="firm-c">{row.firm_name ?? "—"}</div>
                    <div className="contact-c">
                      {row.partner_name ?? "—"}
                      {row.partner_title ? (
                        <>
                          {" · "}
                          {row.partner_title}
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      statusCode={row.status_code}
                      statusLabel={row.status_label}
                    />
                  </td>
                  <td style={{ fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: 11 }}>
                    {formatDays(row.days_since_last_contact)}
                  </td>
                  <td>
                    <EmailStatsCell row={row} />
                  </td>
                  <td className="comment-af">
                    <CommentaryCell row={row} />
                  </td>
                </tr>
                {expanded ? (
                  <tr onClick={(e) => e.stopPropagation()}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <TrackerRowDrawer
                        campaignPartnerId={row.id}
                        currentStatusCode={row.status_code}
                        firmName={row.firm_name}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Commentary cell renderer. V1's data layer stores two derived fields
 * on the row — `company_summary` (two-sentence thesis gist) and
 * `partner_why_them` (synthesis paragraph). V4's mockup shows a
 * chronological ` | `-separated string with `[YYYY-MM-DD]` chips; we
 * don't have per-event entries in V1 yet, so we render the two-paragraph
 * derived context honestly and flag the absence rather than fabricating
 * a date-chipped chronology. Once the Phase 5 commentary log lands,
 * this component swaps to rendering the real chronology with V4's
 * `.dt` date chips.
 */
function CommentaryCell({ row }: { row: TrackerRow }) {
  const hasAny = row.company_summary || row.partner_why_them;
  if (!hasAny) {
    return (
      <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
        No commentary on file yet.
      </span>
    );
  }
  return (
    <>
      {row.company_summary ? <div>{row.company_summary}</div> : null}
      {row.partner_why_them ? (
        <div style={{ marginTop: 6 }}>
          <span className="dt">[Why them]</span> {row.partner_why_them}
        </div>
      ) : null}
    </>
  );
}

/**
 * Per-row email stats. Two lines:
 *   1. `↓ N in · ↑ N out · Xd ago` — counts + relative last-touched
 *   2. latest subject (truncated to 60 chars)
 *
 * When a partner has zero contact_events, shows the faint
 * "no email traffic yet" line — matches the empty-state vocabulary used
 * elsewhere in the app (weekly section, drawer commentary log).
 */
function EmailStatsCell({ row }: { row: TrackerRow }) {
  const totalEvents = row.emails_in + row.emails_out;
  if (totalEvents === 0 && !row.last_event_at) {
    return (
      <span style={{ color: "var(--text-faint)", fontStyle: "italic", fontSize: 11 }}>
        no email traffic yet
      </span>
    );
  }

  const truncated = truncateSubject(row.latest_subject, 60);
  const relative = formatLastTouched(row.last_event_at);

  return (
    <div style={{ fontSize: 11, lineHeight: 1.55 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
          color: "var(--text-dim)",
        }}
      >
        <span title={`${row.emails_in} inbound`}>
          <span style={{ color: "var(--green)" }}>↓</span>{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {row.emails_in}
          </span>
        </span>
        <span title={`${row.emails_out} outbound`}>
          <span style={{ color: "var(--accent)" }}>↑</span>{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {row.emails_out}
          </span>
        </span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span style={{ color: "var(--text-faint)" }}>{relative}</span>
      </div>
      {truncated ? (
        <div
          style={{
            marginTop: 3,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
          title={row.latest_subject ?? undefined}
        >
          {truncated}
        </div>
      ) : null}
    </div>
  );
}
