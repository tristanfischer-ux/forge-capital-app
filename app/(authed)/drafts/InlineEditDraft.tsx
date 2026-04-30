"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDraftEdits } from "./actions";

/**
 * Inline edit widget for a draft row in the Gmail drafts panel.
 *
 * Shows a compact "Edit ✎" button by default. When clicked, opens a modal
 * with textareas for subject and body. "Save" calls `saveDraftEdits` and
 * refreshes; "Cancel" reverts without saving.
 */
export function InlineEditDraft({
  campaignPartnerId,
  initialSubject,
  initialBody,
}: {
  campaignPartnerId: string;
  initialSubject: string;
  initialBody: string;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleEdit() {
    setMode("edit");
    setError(null);
  }

  function handleCancel() {
    setSubject(initialSubject);
    setBody(initialBody);
    setMode("view");
    setError(null);
  }

  async function handleSave() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body cannot be empty.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await saveDraftEdits({ campaignPartnerId, subject, body });
    setPending(false);
    if (result.ok) {
      setMode("view");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  if (mode === "view") {
    return (
      <button
        type="button"
        className="btn-gmail"
        onClick={handleEdit}
        title="Edit this draft's subject and body"
        style={{ fontSize: 11 }}
      >
        Edit ✎
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "var(--shadow)",
          padding: 24,
          width: "min(640px, 90vw)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          Edit draft
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Subject
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-alt)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            rows={14}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-alt)",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
            }}
          />
        </label>

        {error ? (
          <div style={{ fontSize: 11, color: "#dc2626" }}>{error}</div>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-dim)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !subject.trim() || !body.trim()}
            style={{
              padding: "5px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: pending ? "not-allowed" : "pointer",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
