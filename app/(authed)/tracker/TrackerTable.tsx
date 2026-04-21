"use client";

import { useMemo, useState } from "react";
import type { TrackerRow } from "@/lib/queries/tracker";
import { StatusBadge } from "./StatusBadge";
import { TierBadge } from "./TierBadge";

/**
 * Tracker grid — mockup-faithful port of Phase2-Mockup-V4 §"Tracker —
 * master sheet preview" (lines 1799–1869) enhanced per V4-FEEDBACK-
 * ROUND-2.md: two-sentence company + investor context, why-them
 * synthesis, days-since column, tier badge (not Hunter 0–100 score),
 * red badge + replacement-hunt CTA for generic_blocked / bounced.
 *
 * Client component because sort + expand are local-state interactions.
 * V1 is read-only — no status edits here (Phase 5).
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

export function TrackerTable({ rows }: { rows: TrackerRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(
    () => sortRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

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
      <span className="ml-1 text-[10px] text-text-faint">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow)]">
      {/* Sheet head strip — port of V4 .sheet-head-strip */}
      <div className="flex items-center justify-between border-b border-[#e4e1ff] bg-accent-softer px-4 py-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-accent-dark">
            Master tracker
          </span>
          <span className="text-text-dim">
            · {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-green-light px-2.5 py-1 text-[11px] font-medium text-green">
            <span className="h-1.5 w-1.5 rounded-full bg-green" />
            Status vocabulary locked to the 16-code legend
          </span>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-alt">
            <th
              scope="col"
              className="cursor-pointer px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
              style={{ width: "14%" }}
              onClick={() => onSort("status")}
            >
              Status{sortIndicator("status")}
            </th>
            <th
              scope="col"
              className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
              style={{ width: "14%" }}
            >
              Tier
            </th>
            <th
              scope="col"
              className="cursor-pointer px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
              style={{ width: "8%" }}
              onClick={() => onSort("days")}
            >
              Days since{sortIndicator("days")}
            </th>
            <th
              scope="col"
              className="cursor-pointer px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
              style={{ width: "26%" }}
              onClick={() => onSort("firm")}
            >
              Firm · Contact{sortIndicator("firm")}
            </th>
            <th
              scope="col"
              className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
            >
              Company + partner context · Why them
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border-soft align-top last:border-b-0 hover:bg-surface-alt"
                onClick={() =>
                  setExpandedId((current) => (current === row.id ? null : row.id))
                }
              >
                <td className="px-3 py-2.5">
                  <StatusBadge
                    statusCode={row.status_code}
                    statusLabel={row.status_label}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <TierBadge tier={row.email_tier} />
                </td>
                <td className="px-3 py-2.5 text-[11px] tabular-nums text-text">
                  {formatDays(row.days_since_last_contact)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-[12px] font-semibold text-text">
                    {row.firm_name ?? "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-dim">
                    {row.partner_name ?? "—"}
                    {row.partner_title ? (
                      <span className="text-text-faint">
                        {" · "}
                        {row.partner_title}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-[460px] px-3 py-2.5 text-[11px] leading-relaxed text-text">
                  {/* Company + partner two-sentence context */}
                  <div>
                    {row.company_summary ?? (
                      <span className="italic text-text-faint">
                        No company context on file yet.
                      </span>
                    )}
                  </div>
                  {/* Why-them synthesis — collapsed by default, revealed on row click */}
                  {row.partner_why_them ? (
                    <div
                      className={`mt-1.5 rounded-[6px] border border-border-soft bg-surface-alt px-2.5 py-1.5 ${
                        expanded ? "" : "line-clamp-2"
                      }`}
                    >
                      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        Why them
                      </div>
                      <div className="text-[11px] text-text">
                        {row.partner_why_them}
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
