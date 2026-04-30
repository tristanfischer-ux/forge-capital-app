"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { discardDraft } from "./actions";

/**
 * Discard draft button with a confirmation dialog.
 *
 * Moves the partner from +2 Drafted → +1 Approved — awaiting draft on
 * confirm. Any pending scheduled_sends rows are cancelled. The founder
 * is reminded to delete any existing Gmail draft manually (V2 will do
 * this automatically).
 */
export function DiscardDraftButton({
  campaignPartnerId,
  partnerLabel,
}: {
  campaignPartnerId: string;
  partnerLabel: string;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setPending(true);
    setError(null);
    const result = await discardDraft({ campaignPartnerId });
    setPending(false);
    if (result.ok) {
      setShowConfirm(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        title="Discard this draft — moves the partner back to Approved state"
        style={{
          padding: "2px 8px",
          borderRadius: 5,
          border: "1px solid #fca5a5",
          background: "#fff1f2",
          color: "#dc2626",
          fontSize: 11,
          fontWeight: 500,
          cursor: "pointer",
          lineHeight: 1.4,
        }}
      >
        Discard
      </button>

      {showConfirm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setShowConfirm(false);
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "var(--shadow)",
              padding: 24,
              width: "min(440px, 90vw)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Discard this draft?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55 }}>
              <p style={{ margin: "0 0 8px" }}>
                This will move <strong>{partnerLabel}</strong> back to{" "}
                <code
                  style={{
                    fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
                    fontSize: 12,
                    background: "var(--surface-alt)",
                    padding: "1px 4px",
                    borderRadius: 3,
                  }}
                >
                  +1 Approved — awaiting draft
                </code>
                . No email will be sent.
              </p>
              <p style={{ margin: 0 }}>
                If you have already created a Gmail draft for this partner,
                please delete it manually from the{" "}
                <strong>outreach/drafts</strong> label in Gmail.
              </p>
            </div>

            {error ? (
              <div style={{ fontSize: 11, color: "#dc2626" }}>{error}</div>
            ) : null}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  setError(null);
                }}
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
                Keep draft
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                style={{
                  padding: "5px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: pending ? "not-allowed" : "pointer",
                  opacity: pending ? 0.7 : 1,
                }}
              >
                {pending ? "Discarding…" : "Yes, discard"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
