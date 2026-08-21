"use client";

import { useEffect, useState } from "react";

export function QuickLog() {
  const [who, setWho] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function save() {
    if (!navigator.onLine) {
      setMsg("Not connected — not saved. Log it again when you have signal.");
      return;
    }
    const row = {
      who,
      channel,
      note,
      queued_at: new Date().toISOString(),
    };
    let res: Response;
    try {
      res = await fetch("/api/desk-touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
    } catch {
      setMsg("Not connected — not saved. Log it again when you have signal.");
      return;
    }
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      suggestions?: unknown;
    };
    if (!body.ok) {
      const extra = body.suggestions
        ? ` Suggestions: ${JSON.stringify(body.suggestions)}`
        : "";
      setMsg((body.error ?? "Not connected — not saved.") + extra);
      return;
    }
    setMsg("Logged. Nothing sent.");
    setNote("");
  }

  return (
    <div>
      <p className="faint">
        {online
          ? "Online — a save writes to the shared book."
          : "Not connected — not saved."}
      </p>
      <label className="faint">Who</label>
      <input
        value={who}
        onChange={(e) => setWho(e.target.value)}
        placeholder="Gareth, Tony, Miha…"
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      />
      <label className="faint">Channel</label>
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      >
        <option value="whatsapp">WhatsApp</option>
        <option value="imessage">iMessage</option>
        <option value="call">Call</option>
        <option value="in_person">In person</option>
      </select>
      <label className="faint">What happened</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={5}
        style={{ width: "100%", fontSize: 16, padding: 10, margin: "4px 0 10px" }}
      />
      <button type="button" className="btn btn-primary" disabled={!who.trim() || !note.trim()} onClick={save}>
        Log this
      </button>
      {msg ? <p className="faint">{msg}</p> : null}
    </div>
  );
}
