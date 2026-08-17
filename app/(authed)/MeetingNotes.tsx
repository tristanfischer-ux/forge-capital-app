"use client";

import { useState, useTransition } from "react";

export function MeetingNotes({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const res = await fetch("/api/meeting-notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meetingId, text }),
          });
          setMsg(res.ok ? "Saved into the desk" : "Could not save");
        });
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="What you heard, what you promised, what to do next…"
        style={{
          width: "100%",
          padding: 8,
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontFamily: "inherit",
        }}
      />
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save note"}
        </button>
        {msg ? <span className="faint">{msg}</span> : null}
      </div>
    </form>
  );
}
