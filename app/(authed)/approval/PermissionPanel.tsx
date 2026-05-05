"use client";

import { useState } from "react";
import { exportPermissionList, updatePermissionStatus } from "@/lib/queries/permission";

/**
 * Permission management panel — shows on the Approval page.
 * Handles the client permission workflow:
 * 1. Export a CSV of investors needing permission
 * 2. Send to client
 * 3. Update status when client responds (approved/denied)
 */
export function PermissionPanel({ campaignId }: { campaignId: string }) {
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");

  async function handleExport() {
    setExporting(true);
    setMessage(null);
    try {
      const result = await exportPermissionList(campaignId);
      if ("error" in result) {
        setMessage(result.error);
        setMessageType("error");
        return;
      }

      // Trigger download
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      setMessage(`Exported ${result.count} investors to ${result.filename}`);
      setMessageType("success");
    } catch (err) {
      setMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      setMessageType("error");
    } finally {
      setExporting(false);
    }
  }

  async function handleMarkApproved() {
    setUpdating(true);
    setMessage(null);
    try {
      // In a real flow, you'd select specific partner IDs. For now, this is a placeholder.
      setMessage("To mark as approved: select investors in the approval sheet, then click 'Mark approved'.");
      setMessageType("info");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div style={{
      padding: "16px 20px",
      background: "var(--surface)",
      borderRadius: 8,
      border: "1px solid var(--border)",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
            Client Permission Gate
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "4px 0 0" }}>
            Export a list of investors needing client approval before outreach. Client responds yes/no — update status accordingly.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              cursor: exporting ? "wait" : "pointer",
            }}
          >
            {exporting ? "Exporting..." : "Export Permission CSV"}
          </button>
        </div>
      </div>

      {message && (
        <div style={{
          fontSize: 12,
          padding: "8px 12px",
          borderRadius: 6,
          background: messageType === "success" ? "rgba(34,197,94,0.1)" : messageType === "error" ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)",
          color: messageType === "success" ? "#16a34a" : messageType === "error" ? "#dc2626" : "#2563eb",
        }}>
          {message}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
        Workflow: (1) Set investors to "pending_approval" in the tracker → (2) Export CSV → (3) Send to client → (4) Update status to "approved" or "denied" when client responds.
      </div>
    </div>
  );
}
