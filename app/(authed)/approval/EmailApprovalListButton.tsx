"use client";

import { useState, useTransition } from "react";
import { emailApprovalListToAddress } from "./emailListAction";

/**
 * Small button on /approval that emails the outgoing approval list
 * (Step 1) as plain text to a review address so Tristan can approve /
 * reject each row from his phone. The resulting email can be replied
 * to directly; the reply parser in Step 2 ingests the annotations.
 */
export function EmailApprovalListButton(props: { campaignId: string }) {
  const [isPending, startTransition] = useTransition();
  const [toEmail, setToEmail] = useState("tristan.fischer@mac.com");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sent"; threadUrl: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onSend() {
    if (isPending) return;
    startTransition(async () => {
      const out = await emailApprovalListToAddress({
        campaignId: props.campaignId,
        toEmail: toEmail.trim(),
      });
      if (out.ok) {
        setState({
          kind: "sent",
          threadUrl: `https://mail.google.com/mail/u/0/#sent/${out.threadId}`,
        });
      } else {
        setState({ kind: "error", message: out.error });
      }
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
    >
      <input
        type="email"
        value={toEmail}
        onChange={(e) => setToEmail(e.target.value)}
        disabled={isPending}
        style={{
          padding: "4px 8px",
          fontSize: 12,
          border: "1px solid var(--border)",
          borderRadius: 4,
          background: "var(--surface)",
          minWidth: 200,
        }}
      />
      <button
        type="button"
        className="ic-btn"
        onClick={onSend}
        disabled={isPending || !toEmail.includes("@")}
        style={{
          background: "var(--accent)",
          border: "none",
          color: "#fff",
          padding: "5px 11px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 4,
          cursor: isPending ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "Sending…" : "Email approval list"}
      </button>
      {state.kind === "sent" ? (
        <a
          href={state.threadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: "var(--green)" }}
        >
          ✓ Sent · open in Gmail ↗
        </a>
      ) : null}
      {state.kind === "error" ? (
        <span style={{ fontSize: 11, color: "var(--red)" }}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
