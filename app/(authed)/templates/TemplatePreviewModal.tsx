"use client";

/**
 * TemplatePreviewModal — client component.
 *
 * Renders a "Preview with real data →" button on the template footer.
 * When clicked, calls the `getTemplatePreviewData` server action with
 * the active campaign ID, then shows the rendered subject + full body
 * (with {{FIRM_NAME}} / {{FIRM_THESIS}} substituted from a real partner)
 * inside a modal overlay.
 *
 * V4 classes used: `.template-card`, `.template-head` (for the modal header
 * accent strip), `.template-foot`, `.btn.primary` (for the trigger button
 * and close button).
 */

import { useState, useCallback } from "react";
import { getTemplatePreviewData } from "./actions";

interface TemplatePreviewModalProps {
  campaignId: string;
  /** Controls the header accent colour — matches the template column's side. */
  side: "asking" | "offering";
}

export function TemplatePreviewModal({
  campaignId,
  side,
}: TemplatePreviewModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    subject: string;
    fullBody: string;
    partnerName: string | null;
    firmName: string | null;
  } | null>(null);

  const handleOpen = useCallback(async () => {
    // If we already have data, just re-open the modal.
    if (preview) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getTemplatePreviewData(campaignId);
      if (!result.ok) {
        setError(result.error);
      } else {
        setPreview({
          subject: result.subject,
          fullBody: result.fullBody,
          partnerName: result.partnerName,
          firmName: result.firmName,
        });
        setOpen(true);
      }
    } finally {
      setLoading(false);
    }
  }, [campaignId, preview]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const headClass =
    side === "asking" ? "template-head inv" : "template-head sup";
  const icoLetter = side === "asking" ? "I" : "S";
  const headTitle =
    side === "asking"
      ? "Rendered preview — Asking-for-money"
      : "Rendered preview — Offering-money";

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        style={{
          fontSize: 11,
          padding: "3px 10px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text-dim)",
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Loading preview…" : "Preview with real data →"}
      </button>

      {/* Inline error — shown below the button without opening the modal */}
      {error && !open ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--red, #ef4444)",
            marginLeft: 8,
            display: "inline-block",
            maxWidth: 360,
          }}
        >
          {error}
        </span>
      ) : null}

      {/* Modal overlay */}
      {open && preview ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "48px 16px 32px",
            background: "rgba(0,0,0,0.35)",
            overflowY: "auto",
          }}
          onClick={(e) => {
            // Close when clicking the backdrop, not the modal itself.
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div
            className="template-card"
            style={{
              width: "100%",
              maxWidth: 680,
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
              position: "relative",
            }}
          >
            {/* Header strip — reuses template-head colour variant */}
            <div className={headClass}>
              <span className="th-ico">{icoLetter}</span>
              <span className="th-title">{headTitle}</span>
              <span
                className="th-shape"
                style={{ marginLeft: "auto", fontStyle: "normal" }}
              >
                {preview.partnerName
                  ? `Using data from: ${preview.partnerName}${preview.firmName ? ` · ${preview.firmName}` : ""}`
                  : "Using most recent partner data"}
              </span>
            </div>

            {/* Email preview body */}
            <div
              style={{
                padding: "20px 24px",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text)",
              }}
            >
              {/* Subject line */}
              <div
                style={{
                  marginBottom: 16,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--surface-raised, #f5f5f7)",
                  border: "1px solid var(--border-soft)",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    fontSize: 10,
                    color: "var(--text-dim)",
                    marginRight: 8,
                  }}
                >
                  Subject
                </span>
                <span style={{ fontWeight: 500 }}>{preview.subject}</span>
              </div>

              {/* Body — preserve newlines */}
              <div style={{ whiteSpace: "pre-wrap" }}>{preview.fullBody}</div>
            </div>

            {/* Footer with close button */}
            <div
              className="template-foot"
              style={{ justifyContent: "flex-end", gap: 8 }}
            >
              <span style={{ fontSize: 11, color: "var(--text-dim)", flex: 1 }}>
                Variables resolved from the most recent partner in this
                campaign. The actual send path resolves per-recipient at send
                time.
              </span>
              <button
                type="button"
                onClick={() => {
                  // Force a fresh fetch next time so data stays current.
                  setPreview(null);
                  handleClose();
                }}
                style={{
                  fontSize: 12,
                  padding: "4px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
