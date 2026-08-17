"use client";

import { useState } from "react";

export function ReplyBox({
  to,
  subject,
}: {
  to: string;
  subject: string;
}) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  async function go(mode: "draft" | "send") {
    setMsg(mode === "send" ? "Sending…" : "Saving draft…");
    const res = await fetch("/api/desk-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
        text,
        mode,
        confirm: mode === "send",
      }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; gmailUrl?: string };
    if (!body.ok) {
      setMsg(body.error ?? "Failed");
      return;
    }
    setMsg(mode === "send" ? "Sent. It is in Gmail Sent." : "Draft parked in Gmail. Nothing sent.");
    setConfirmSend(false);
    if (body.gmailUrl) {
      window.open(body.gmailUrl, "_blank", "noreferrer");
    }
  }

  if (!to) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Reply to ${to} — this never sends until you confirm.`}
        rows={4}
        style={{ width: "100%", fontSize: 14, padding: 8 }}
      />
      <div className="btn-row">
        <button type="button" className="btn" disabled={!text.trim()} onClick={() => go("draft")}>
          Save as Gmail draft
        </button>
        {!confirmSend ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => setConfirmSend(true)}
          >
            Send now…
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => go("send")}>
            Confirm send to {to}
          </button>
        )}
      </div>
      {msg ? <div className="faint">{msg}</div> : null}
    </div>
  );
}
