"use client";

/**
 * Client wrapper for the outgoing approval table.
 *
 * Adds:
 *  - Per-row checkboxes and a "select all" checkbox in the table header
 *  - A floating `.batch-bar` (from v4-mockup.css) that appears when ≥1 row
 *    is selected, with an "Approve selected (N)" button
 *  - Keyboard shortcuts:
 *      A           → approve the focused row
 *      N / ArrowDown → focus next row
 *      P / ArrowUp   → focus previous row
 *  - A keyboard shortcut legend strip above the table
 */

import { useState, useEffect, useCallback, useTransition } from "react";
import { bulkApprove } from "./bulkApproveAction";
import type { OutgoingApprovalRow } from "@/lib/queries/approval";

interface Props {
  rows: OutgoingApprovalRow[];
  /** Column header noun — varies by campaign_intent (e.g. "Investor · Contact",
   *  "Customer · Contact"). Passed from the server component so this client
   *  component doesn't need to re-derive it. */
  contactColumnHeader: string;
}

export function OutgoingApprovalClient({ rows, contactColumnHeader }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);

  const allIds = rows.map((r) => r.campaign_partner_id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const handleApproveSelected = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await bulkApprove({ campaignPartnerIds: ids });
      if (result.ok) {
        const failMsg =
          result.failed.length > 0 ? ` (${result.failed.length} failed)` : "";
        setToast({
          type: "ok",
          msg: `${result.approved} row${result.approved === 1 ? "" : "s"} approved${failMsg}.`,
        });
        setSelected(new Set());
        setFocusedIdx(-1);
      } else {
        setToast({ type: "err", msg: result.error });
      }
    });
  }, [selected]);

  const handleApproveFocused = useCallback(() => {
    if (focusedIdx < 0 || focusedIdx >= rows.length) return;
    const id = rows[focusedIdx].campaign_partner_id;
    startTransition(async () => {
      const result = await bulkApprove({ campaignPartnerIds: [id] });
      if (result.ok) {
        setToast({ type: "ok", msg: "Row approved." });
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        setToast({ type: "err", msg: result.error });
      }
    });
  }, [focusedIdx, rows]);

  // Keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept when focus is inside an input / textarea / select /
      // contenteditable (e.g. the ContactPicker inline editor).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case "a":
        case "A":
          e.preventDefault();
          handleApproveFocused();
          break;
        case "n":
        case "N":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx((prev) =>
            rows.length === 0 ? -1 : Math.min(prev + 1, rows.length - 1),
          );
          break;
        case "p":
        case "P":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx((prev) => (prev <= 0 ? 0 : prev - 1));
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleApproveFocused, rows.length]);

  // Auto-dismiss toast after 4 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (rows.length === 0) {
    // Empty state — pass through to the static table rendered by the server
    // component (no checkboxes, no bar needed).
    return null;
  }

  return (
    <>
      {/* ── Keyboard shortcut legend ─────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          padding: "6px 0 8px 2px",
          fontSize: 11,
          color: "var(--text-dim)",
          flexWrap: "wrap",
        }}
        aria-label="Keyboard shortcuts"
      >
        <span style={{ fontWeight: 600, color: "var(--text)" }}>
          Shortcuts:
        </span>
        <ShortcutKey label="A" desc="Approve focused row" />
        <ShortcutKey label="N / ↓" desc="Next row" />
        <ShortcutKey label="P / ↑" desc="Previous row" />
      </div>

      {/* ── Floating batch bar ────────────────────────────────────── */}
      <div className={`batch-bar${selected.size > 0 ? " armed" : ""}`}>
        <div className="bb-sel">
          <button
            type="button"
            className={`bb-chk${allSelected ? " on" : someSelected ? " on" : ""}`}
            onClick={toggleAll}
            aria-label={allSelected ? "Deselect all rows" : "Select all rows"}
            aria-pressed={allSelected}
            title={allSelected ? "Deselect all" : "Select all"}
          >
            {allSelected ? "✓" : someSelected ? "–" : ""}
          </button>
        </div>
        {selected.size > 0 ? (
          <>
            <span className="bb-count">{selected.size}</span>
            <span className="bb-label">
              row{selected.size === 1 ? "" : "s"} selected
            </span>
          </>
        ) : (
          <span className="bb-label">Select rows to bulk approve</span>
        )}
        <span className="bb-spacer" />
        {selected.size > 0 && (
          <button
            type="button"
            className="bb-btn"
            onClick={() => setSelected(new Set())}
            disabled={isPending}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="bb-btn primary"
          onClick={handleApproveSelected}
          disabled={isPending || selected.size === 0}
        >
          {isPending
            ? "Approving…"
            : selected.size > 0
              ? `Approve selected (${selected.size})`
              : "Approve selected"}
        </button>
      </div>

      {/* ── Toast notification ────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "8px 14px",
            marginBottom: 8,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            background:
              toast.type === "ok" ? "#f0fdf4" : "#fff5f5",
            color:
              toast.type === "ok" ? "var(--green, #16a34a)" : "var(--red, #dc2626)",
            border: `1px solid ${
              toast.type === "ok"
                ? "var(--green, #16a34a)"
                : "var(--red, #dc2626)"
            }`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Table with checkboxes ─────────────────────────────────── */}
      <table className="sheet">
        <thead>
          <tr>
            <th style={{ width: 36, textAlign: "center" }}>
              <button
                type="button"
                className={`bb-chk${allSelected ? " on" : someSelected ? " on" : ""}`}
                style={{ margin: "0 auto" }}
                onClick={toggleAll}
                aria-label={allSelected ? "Deselect all" : "Select all"}
                title={allSelected ? "Deselect all rows" : "Select all rows"}
              >
                {allSelected ? "✓" : someSelected ? "–" : ""}
              </button>
            </th>
            <th style={{ width: "28%" }}>{contactColumnHeader}</th>
            <th>Why them (synthesis)</th>
            <th style={{ width: "16%" }}>Comment SW</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const id = row.campaign_partner_id;
            const isFocused = focusedIdx === idx;
            const isChecked = selected.has(id);
            return (
              <tr
                key={id}
                style={{
                  outline: isFocused ? "2px solid var(--accent)" : undefined,
                  outlineOffset: isFocused ? "-2px" : undefined,
                  background: isChecked
                    ? "var(--accent-softer, #eef2ff)"
                    : undefined,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onClick={() => {
                  setFocusedIdx(idx);
                  toggleRow(id);
                }}
                tabIndex={0}
                onFocus={() => setFocusedIdx(idx)}
                aria-selected={isChecked}
              >
                {/* Checkbox cell */}
                <td
                  style={{ width: 36, textAlign: "center" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedIdx(idx);
                    toggleRow(id);
                  }}
                >
                  <span
                    className={`bb-chk${isChecked ? " on" : ""}`}
                    style={{
                      margin: "0 auto",
                      display: "inline-flex",
                      pointerEvents: "none",
                    }}
                    aria-hidden="true"
                  >
                    {isChecked ? "✓" : ""}
                  </span>
                </td>

                {/* Firm + contact */}
                <td>
                  <div className="firm-c">{row.firm_name ?? "—"}</div>
                  {row.partner_name || row.partner_title ? (
                    <div className="contact-c">
                      {[row.partner_name, row.partner_title]
                        .filter((s): s is string => !!s && s.trim().length > 0)
                        .join(" · ")}
                      {row.hq_location ? (
                        <span style={{ color: "var(--text-faint)" }}>
                          {" · "}
                          {row.hq_location}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </td>

                {/* Synthesis */}
                <td className="synth">
                  {row.why_them ?? (
                    <span
                      style={{ color: "var(--text-faint)", fontStyle: "italic" }}
                    >
                      &mdash; synthesis pending &mdash;
                    </span>
                  )}
                </td>

                {/* Comment SW — blank until approver fills it in */}
                <td>
                  <span className="approve-blank">&mdash;</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function ShortcutKey({ label, desc }: { label: string; desc: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <kbd
        style={{
          display: "inline-block",
          padding: "1px 6px",
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text)",
          lineHeight: 1.6,
        }}
      >
        {label}
      </kbd>
      <span>{desc}</span>
    </span>
  );
}
