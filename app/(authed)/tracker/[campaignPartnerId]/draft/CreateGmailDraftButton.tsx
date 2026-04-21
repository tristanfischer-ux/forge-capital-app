"use client";

import { useState, useTransition } from "react";
import { createGmailDraftAction } from "./createGmailDraftAction";

/**
 * "Create Gmail draft" button. Calls the server action with the already-
 * composed subject + body; server action uses the signed-in user's stored
 * Gmail OAuth refresh_token to mint an access_token and POST to the Gmail
 * drafts API. On success, opens the new draft in Gmail in a new tab.
 *
 * If the user hasn't yet connected their Gmail (NOT_CONNECTED), we swap
 * the button for a "Connect Gmail to draft" link pointing at the OAuth
 * initiation route.
 */
export function CreateGmailDraftButton(props: {
  to: string;
  subject: string;
  body: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "ok"; url: string }
    | { kind: "not_connected" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onClick() {
    if (isPending) return;
    startTransition(async () => {
      const out = await createGmailDraftAction(props);
      if (out.ok) {
        setState({ kind: "ok", url: out.gmailUrl });
        window.open(out.gmailUrl, "_blank", "noopener");
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
        Connect Gmail to create drafts
      </a>
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn primary"
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? "Creating draft…" : "Create Gmail draft"}
      </button>
      {state.kind === "ok" ? (
        <a
          href={state.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--green)", fontSize: 12, fontWeight: 500 }}
        >
          ✓ Draft created — open in Gmail ↗
        </a>
      ) : null}
      {state.kind === "error" ? (
        <span style={{ color: "var(--red)", fontSize: 12 }}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
