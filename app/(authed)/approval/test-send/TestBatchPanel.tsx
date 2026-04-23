"use client";

import { useState, useTransition } from "react";
import {
  exportBatchToXlsx,
  sendTestBatch,
  type PerRowOutcome,
} from "./actions";

interface PreviewRow {
  firmName: string | null;
  partnerName: string | null;
}

export function TestBatchPanel(props: {
  campaignId: string;
  campaignName: string;
  pendingCount: number;
  previewRows: PreviewRow[];
}) {
  const [toEmail, setToEmail] = useState("tristan.fischer@mac.com");
  const [count, setCount] = useState<number>(
    Math.min(20, props.pendingCount),
  );
  const [isPending, startTransition] = useTransition();
  const [isExporting, startExportTransition] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | {
        kind: "done";
        sent: number;
        failed: number;
        rows: PerRowOutcome[];
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onStartSend() {
    if (isPending) return;
    setResult({ kind: "idle" });
    startTransition(async () => {
      const out = await sendTestBatch({
        campaignId: props.campaignId,
        toEmail: toEmail.trim(),
        maxCount: count,
      });
      if (out.ok) {
        setResult({
          kind: "done",
          sent: out.sent,
          failed: out.failed,
          rows: out.rows,
        });
      } else {
        setResult({ kind: "error", message: out.error });
      }
    });
  }

  function onExport() {
    if (isExporting) return;
    setExportError(null);
    startExportTransition(async () => {
      const out = await exportBatchToXlsx({ campaignId: props.campaignId });
      if (!out.ok) {
        setExportError(out.error);
        return;
      }
      // Decode base64 → Blob → anchor-click download. We do this in the
      // browser rather than returning a streaming response so the server
      // action stays a plain JSON-ish payload the React Flight layer is
      // happy with.
      try {
        const binary = atob(out.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = out.filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        // Let the browser finish the download before revoking.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setExportError(`download failed: ${msg}`);
      }
    });
  }

  return (
    <section className="mb-4 rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <h2 className="mb-3 text-[14px] font-semibold text-text">
        Dispatch batch
      </h2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px]">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Test address
          </span>
          <input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-text-dim">
            Batch size
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
      </div>

      <div className="mt-3 text-[11px] text-text-dim">
        Drafts the top {count} pending-approval rows and sends each to{" "}
        <code>{toEmail}</code>. Subjects prefixed with <code>[TEST]</code>.
        Each send logs a <code>contact_events</code> row with{" "}
        <code>kind = test_send</code>. Tracker status is not advanced.
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
                {r.partnerName ? (
                  <span className="text-text-dim"> · {r.partnerName}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {result.kind === "idle" || result.kind === "error" ? (
          <>
            <button
              type="button"
              className="btn primary"
              onClick={() => setResult({ kind: "confirming" })}
              disabled={
                isPending || props.pendingCount === 0 || !toEmail.includes("@")
              }
              style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
            >
              Send {count} as [TEST] to {toEmail}
            </button>
            <button
              type="button"
              className="btn"
              onClick={onExport}
              disabled={isExporting || props.pendingCount === 0}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              title="Download all pending drafts as an Excel workbook — dry run, nothing sent."
            >
              {isExporting ? "Exporting…" : "Export drafts as .xlsx"}
            </button>
            {exportError ? (
              <span style={{ color: "var(--red)", fontSize: 12 }}>
                {exportError}
              </span>
            ) : null}
          </>
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
              Really send {count} emails to {toEmail}?
            </span>
            <button
              type="button"
              className="btn primary"
              onClick={onStartSend}
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
              {isPending ? "Sending…" : "Yes, send all"}
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
            ✓ Batch complete — {result.sent} sent
            {result.failed > 0 ? `, ${result.failed} failed` : ""}.
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-[11px]">
            {result.rows.map((r) => (
              <li key={r.campaignPartnerId} className="flex items-start gap-2">
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
                  <b>{r.firmName ?? "—"}</b>
                  {r.partnerName ? (
                    <span className="text-text-dim"> · {r.partnerName}</span>
                  ) : null}
                  {!r.ok ? (
                    <span className="text-[var(--red)]"> — {r.detail}</span>
                  ) : null}
                </span>
                {r.ok ? (
                  <a
                    href={r.detail}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-dark"
                  >
                    open in Gmail ↗
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
