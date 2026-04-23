"use client";

import { useState, useTransition } from "react";
import { sendGmailMessageAction } from "./sendGmailMessageAction";

/**
 * "Send via Gmail" button. Two-step gesture:
 *   click 1 → swaps to a confirm-row ("Send to <email> now? · Cancel")
 *   click 2 → fires the send via Gmail API (gmail.compose scope includes send)
 *
 * V4-FEEDBACK-ROUND-2.md "No auto-send anywhere" rule preserved by the
 * explicit confirm step. Tristan asked for this 2026-04-23 during the
 * Wren audit because the existing Create-Gmail-draft path required
 * leaving the app to send.
 */
export function SendGmailMessageButton(props: {
  to: string;
  subject: string;
  body: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "sent"; url: string }
    | { kind: "not_connected" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onSend() {
    if (isPending) return;
    startTransition(async () => {
      const out = await sendGmailMessageAction(props);
      if (out.ok) {
        setState({ kind: "sent", url: out.gmailUrl });
      } else if (out.error === "NOT_CONNECTED") {
        setState({ kind: "not_connected" });
      } else {
        setState({ kind: "error", message: out.message });
      }
    });
  }

  if (state.kind === "not_connected") {
    return (
      <a
        href="/api/auth/gmail"
        className="btn primary"
        style={{ textDecoration: "none" }}
      >
        Connect Gmail to send
      </a>
    );
  }

  if (state.kind === "sent") {
    return (
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          fontSize: 12,
          color: "var(--green)",
        }}
      >
        <span style={{ fontWeight: 600 }}>✓ Sent to {props.to}</span>
        <a
          href={state.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--green)" }}
        >
          Open in Gmail Sent ↗
        </a>
      </div>
    );
  }

  if (state.kind === "confirming") {
    return (
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "8px 12px",
          background: "#fef3c7",
          border: "1px solid #fcd34d",
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--amber)", fontWeight: 600 }}>
          Send this email now to {props.to}?
        </span>
        <button
          type="button"
          className="btn primary"
          onClick={onSend}
          disabled={isPending}
          style={{ background: "var(--accent)", borderColor: "var(--accent)" }}
        >
          {isPending ? "Sending…" : "Yes, send now"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setState({ kind: "idle" })}
          disabled={isPending}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        className="btn primary"
        onClick={() => setState({ kind: "confirming" })}
        style={{
          background: "var(--green)",
          borderColor: "var(--green)",
          color: "#fff",
        }}
      >
        Send via Gmail →
      </button>
      {state.kind === "error" ? (
        <span style={{ color: "var(--red)", fontSize: 12 }}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
