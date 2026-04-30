"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { sendWeeklyDigestToCounterpart } from "./actions";

/**
 * Footer for the weekly counterpart update. Two buttons:
 *   1. "Edit copy" — toggles inline editing of the digest text
 *   2. "Send to {counterpart}" — sends the digest via Gmail
 *
 * Extracted from the server component page.tsx to support interactivity.
 */
export function WeeklyFooter({
  campaignId,
  counterpartName,
  counterpartEmail,
}: {
  campaignId: string;
  counterpartName: string | null;
  counterpartEmail: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [sendState, setSendState] = useState<
    | { kind: "idle" }
    | { kind: "sent"; to: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const hasCounterpart = !!counterpartEmail;
  const label = counterpartName ?? "counterpart";

  function handleEdit() {
    if (editing) {
      setEditing(false);
      return;
    }
    const digestWrap = document.querySelector(".weekly-wrap");
    if (digestWrap) {
      setEditText(digestWrap.textContent ?? "");
    }
    setEditing(true);
  }

  function handleSend() {
    if (!counterpartEmail) return;
    startTransition(async () => {
      const res = await sendWeeklyDigestToCounterpart({
        campaignId,
        customBody: editing ? editText : undefined,
      });
      if (res.ok) {
        setSendState({ kind: "sent", to: res.to });
      } else {
        setSendState({ kind: "error", message: res.error });
      }
    });
  }

  return (
    <>
      {editing && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border, #e5e7eb)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-faint, #9ca3af)", marginBottom: 6 }}>
            Edit digest copy before sending
          </div>
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={12}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.6,
              padding: 12,
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 6,
              resize: "vertical",
              background: "var(--surface, #fff)",
              color: "var(--text, #1f2937)",
            }}
          />
          <div style={{ fontSize: 11, color: "var(--text-faint, #9ca3af)", marginTop: 4 }}>
            Edit the text above, then click &ldquo;Send to {label}&rdquo; to send your edited version.
          </div>
        </div>
      )}

      <div className="weekly-foot">
        <span>
          Generated automatically &middot;{" "}
          <b>nothing is sent</b> until you click Send below.
        </span>
        <span className="wf-spacer" />

        <button
          type="button"
          className="btn"
          onClick={handleEdit}
          style={{ opacity: editing ? 1 : 0.9 }}
          title={editing ? "Close the editor" : "Edit the digest text before sending"}
        >
          {editing ? "Close editor" : "Edit copy"}
        </button>

        {sendState.kind === "sent" ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--success, #15803d)",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ✓ Sent to {sendState.to}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              type="button"
              className="btn primary"
              onClick={handleSend}
              disabled={isPending || !hasCounterpart}
              style={{
                cursor: isPending ? "wait" : !hasCounterpart ? "not-allowed" : "pointer",
                opacity: !hasCounterpart ? 0.6 : 1,
              }}
              title={
                !hasCounterpart
                  ? "No counterpart email set on this campaign — add one in campaign settings"
                  : `Send the weekly digest to ${counterpartEmail}`
              }
            >
              {isPending
                ? "Sending..."
                : `Send to ${label} →`}
            </button>
            {sendState.kind === "error" && (
              <div style={{ fontSize: 12, color: "var(--danger, #b91c1c)" }}>
                {sendState.message}
              </div>
            )}
            {!hasCounterpart && (
              <div style={{ fontSize: 11, color: "var(--text-faint, #9ca3af)" }}>
                Set a counterpart email in campaign settings first
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
