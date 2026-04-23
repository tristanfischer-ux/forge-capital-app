"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  queueScheduledBatch,
  type QueuedRowSummary,
} from "./actions";

interface PreviewRow {
  firmName: string | null;
  hqLocation: string | null;
}

/**
 * Form for queueing a time-windowed batch. Mirrors the TestBatchPanel
 * layout (stays familiar) but swaps the test-address input for the
 * local-window + target-date controls.
 */
export function ScheduleBatchPanel(props: {
  campaignId: string;
  campaignName: string;
  pendingCount: number;
  defaultTargetDate: string;
  previewRows: PreviewRow[];
}) {
  const [count, setCount] = useState<number>(
    Math.min(20, props.pendingCount),
  );
  const [windowStart, setWindowStart] = useState<number>(6);
  const [windowEnd, setWindowEnd] = useState<number>(7);
  const [targetDate, setTargetDate] = useState<string>(props.defaultTargetDate);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | {
        kind: "done";
        queuedCount: number;
        skippedCount: number;
        rows: QueuedRowSummary[];
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onStartQueue() {
    if (isPending) return;
    setResult({ kind: "idle" });
    startTransition(async () => {
      const out = await queueScheduledBatch({
        campaignId: props.campaignId,
        maxCount: count,
        windowLocalStartHour: windowStart,
        windowLocalEndHour: windowEnd,
        targetDate,
      });
      if (out.ok) {
        setResult({
          kind: "done",
          queuedCount: out.queuedCount,
          skippedCount: out.skippedCount,
          rows: out.rows,
        });
      } else {
        setResult({ kind: "error", message: out.error });
      }
    });
  }

  const windowValid =
    Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    windowStart >= 0 &&
    windowEnd <= 24 &&
    windowEnd > windowStart;

  return (
    <section className="mb-4 rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <h2 className="mb-3 text-[14px] font-semibold text-text">
        Queue batch
      </h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Count
          </span>
          <input
            type="number"
            min={1}
            max={Math.max(1, props.pendingCount)}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
            }
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Local start hour
          </span>
          <input
            type="number"
            min={0}
            max={23}
            value={windowStart}
            onChange={(e) =>
              setWindowStart(Math.max(0, Math.min(23, Number(e.target.value) || 0)))
            }
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Local end hour
          </span>
          <input
            type="number"
            min={1}
            max={24}
            value={windowEnd}
            onChange={(e) =>
              setWindowEnd(Math.max(1, Math.min(24, Number(e.target.value) || 1)))
            }
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Target date
          </span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-3 text-[11px] text-text-dim">
        Each send arrives between {windowStart.toString().padStart(2, "0")}:00
        and {windowEnd.toString().padStart(2, "0")}:00 local time on{" "}
        <code>{targetDate}</code>. Composes drafts via the shared pipeline
        (credibility + company + per-investor synthesis + CTA) and inserts a{" "}
        <code>scheduled_sends</code> row per partner. Dispatch happens
        asynchronously — check{" "}
        <Link
          href="/approval/scheduled"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          /approval/scheduled
        </Link>{" "}
        to monitor.
      </div>

      {props.previewRows.length > 0 ? (
        <div className="mt-4 border-t border-border-soft pt-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-dim">
            First {props.previewRows.length} firms in the queue
          </div>
          <ul className="grid grid-cols-1 gap-0.5 text-[12px] text-text md:grid-cols-2">
            {props.previewRows.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.firmName ?? "—"}</span>
                {r.hqLocation ? (
                  <span className="text-text-dim"> · {r.hqLocation}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {result.kind === "idle" || result.kind === "error" ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => setResult({ kind: "confirming" })}
            disabled={
              isPending || props.pendingCount === 0 || !windowValid
            }
            style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
          >
            Queue {count} for {windowStart.toString().padStart(2, "0")}:00–
            {windowEnd.toString().padStart(2, "0")}:00 local on {targetDate}
          </button>
        ) : null}

        {result.kind === "confirming" ? (
          <>
            <span
              style={{
                fontSize: 12,
                color: "var(--amber)",
                fontWeight: 600,
                marginRight: 6,
              }}
            >
              Queue {count} real sends for {targetDate}?
            </span>
            <button
              type="button"
              className="btn primary"
              onClick={onStartQueue}
              disabled={isPending}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: "var(--accent)",
                borderColor: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {isPending ? "Queueing…" : "Yes, queue them"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setResult({ kind: "idle" })}
              disabled={isPending}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              Cancel
            </button>
          </>
        ) : null}

        {result.kind === "error" ? (
          <span style={{ color: "var(--red)", fontSize: 12 }}>
            {result.message}
          </span>
        ) : null}
      </div>

      {result.kind === "done" ? (
        <div className="mt-4 rounded-md border border-border-soft bg-surface-alt p-3">
          <div className="mb-2 text-[13px] font-semibold text-text">
            ✓ Queued {result.queuedCount}
            {result.skippedCount > 0
              ? `, skipped ${result.skippedCount}`
              : ""}
            .{" "}
            <Link
              href="/approval/scheduled"
              className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
            >
              Open the queue monitor →
            </Link>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-[11px]">
            {result.rows.map((r) => (
              <li key={r.partnerId} className="flex items-start gap-2">
                <span
                  style={{
                    color: r.ok ? "var(--green)" : "var(--red)",
                    fontWeight: 700,
                    minWidth: 14,
                  }}
                >
                  {r.ok ? "✓" : "✗"}
                </span>
                <span className="flex-1 text-text">
                  <b>{r.firmName ?? "—"}</b>{" "}
                  <span className="text-text-dim">· {r.tz}</span>
                  {r.ok && r.scheduledForUtc ? (
                    <span className="text-text-dim">
                      {" "}
                      · send UTC{" "}
                      {new Date(r.scheduledForUtc).toISOString().slice(11, 16)}
                    </span>
                  ) : null}
                  {!r.ok ? (
                    <span className="text-[var(--red)]"> — {r.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
