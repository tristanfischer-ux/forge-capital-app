"use client";

import { useState, useTransition } from "react";
import { sendWeeklyDigestToMe } from "./actions";

/**
 * "Send to me now" button. Dispatches the currently previewed digest via
 * Gmail to the authed user's own address (pulled server-side from the
 * gmail_tokens row; no PII flows through the client).
 *
 * UX: single state machine — idle / sending / sent / error. No
 * confirm prompt; the label makes it plain the action is a self-send,
 * and the audit-log UX stays consistent with the rest of the app.
 */
export function SendDigestButton({ campaignId }: { campaignId: string }) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sent"; to: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onClick() {
    startTransition(async () => {
      const res = await sendWeeklyDigestToMe({ campaignId });
      if (res.ok) {
        setState({ kind: "sent", to: res.to });
      } else {
        setState({ kind: "error", message: res.error });
      }
    });
  }

  if (state.kind === "sent") {
    return (
      <div
        style={{
          fontSize: 13,
          color: "var(--success, #15803d)",
          fontWeight: 500,
        }}
      >
        Sent to {state.to}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="btn primary"
        style={{ cursor: isPending ? "wait" : "pointer" }}
      >
        {isPending ? "Sending..." : "Send to me now"}
      </button>
      {state.kind === "error" ? (
        <div style={{ fontSize: 12, color: "var(--danger, #b91c1c)" }}>
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
