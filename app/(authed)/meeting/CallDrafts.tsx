"use client";

import { useState, useTransition } from "react";
import { createCallDraft } from "./actions";

export function CallDrafts({
  meetingId,
  canDraft,
  blockedReason,
}: {
  meetingId: string;
  canDraft: boolean;
  blockedReason: string | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go(kind: "thank-you" | "follow-up") {
    start(async () => {
      setMsg(null);
      const box = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-meeting-notes="${CSS.escape(meetingId)}"]`,
      );
      const result = await createCallDraft({
        meetingId,
        kind,
        summary: box?.value ?? "",
      });
      if (!result.ok) {
        setMsg(result.error);
        return;
      }
      setMsg(
        kind === "thank-you"
          ? "Thank-you draft is in Gmail. Nothing was sent."
          : "Follow-up draft is in Gmail. Nothing was sent.",
      );
      window.open(result.gmailUrl, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="sub" style={{ paddingLeft: 0 }}>
        Drafts only. You approve in Gmail. A named person and a verified
        address are required.
      </p>
      {blockedReason ? <p className="note">{blockedReason}</p> : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canDraft || pending}
          onClick={() => go("thank-you")}
        >
          {pending ? "Working…" : "Thank-you draft"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canDraft || pending}
          onClick={() => go("follow-up")}
        >
          Follow-up draft
        </button>
      </div>
      {msg ? <p className="note">{msg}</p> : null}
    </div>
  );
}
