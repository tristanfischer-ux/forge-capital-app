"use client";

import { useRef, useState } from "react";
import { importApprovalDecisions } from "./import-approval-actions";

/**
 * Export/Import approval buttons for the pipeline page.
 *
 * Export: triggers a GET to /api/export-for-approval?c=<campaignId>
 * which returns an Excel file for download.
 *
 * Import: file picker → base64 encode → server action → summary.
 *
 * Placed in the Approval section, after the outgoing sheet, before
 * the incoming replies. Follows V4's `.ic-btn` button style.
 */
export function ApprovalExcelButtons({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    approved: number;
    declined: number;
    skipped: number;
    notFound: number;
    errors: string[];
  } | null>(null);

  const handleExport = () => {
    const url = `/api/export-for-approval?c=${encodeURIComponent(campaignId)}`;
    window.open(url, "_blank");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      // Read file as base64
      const buf = await file.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");

      const result = await importApprovalDecisions({
        campaignId,
        fileBase64: base64,
        fileName: file.name,
      });

      setImportResult(result);
    } catch (err) {
      setImportResult({
        approved: 0,
        declined: 0,
        skipped: 0,
        notFound: 0,
        errors: [err instanceof Error ? err.message : "Import failed"],
      });
    } finally {
      setImporting(false);
      // Reset file input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "14px 16px",
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <b style={{ color: "var(--text)" }}>Excel workflow</b>
        <span style={{ color: "var(--text-dim)" }}>
          Export the pending list, send to your counterpart, import their
          decisions.
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={handleExport}
          className="ic-btn"
          style={{
            background: "var(--accent-2)",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Export for approval &rarr;
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="ic-btn"
          disabled={importing}
          style={{
            background: importing ? "var(--text-faint)" : "var(--green)",
            cursor: importing ? "wait" : "pointer",
            opacity: importing ? 0.7 : 1,
          }}
        >
          {importing ? "Importing..." : "Import decisions"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleImport}
          style={{ display: "none" }}
        />
      </div>

      {/* Import result summary */}
      {importResult && (
        <div
          style={{
            padding: "10px 12px",
            background: importResult.errors.length > 0
              ? "var(--red-bg, #fef2f2)"
              : "var(--green-bg, #f0fdf4)",
            border: `1px solid ${
              importResult.errors.length > 0
                ? "var(--red-border, #fecaca)"
                : "var(--green-border, #bbf7d0)"
            }`,
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {importResult.errors.length > 0 ? (
            <div style={{ color: "var(--red, #dc2626)" }}>
              {importResult.errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--green, #16a34a)" }}>
              <b>Import complete:</b>{" "}
              {importResult.approved} approved,{" "}
              {importResult.declined} declined,{" "}
              {importResult.skipped} skipped
              {importResult.notFound > 0 &&
                `, ${importResult.notFound} not found`}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          color: "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        <b>How it works:</b> Export creates an Excel with pending partners.
        Fill the &ldquo;Decision&rdquo; column with &ldquo;yes&rdquo;,
        &ldquo;no&rdquo;, or &ldquo;skip&rdquo;. Import reads the decisions
        and updates the tracker. Nothing is sent automatically.
      </div>
    </div>
  );
}
