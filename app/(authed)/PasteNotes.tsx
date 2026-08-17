"use client";

import { useState } from "react";
import type { N2AProposal } from "@/lib/desk/notes-to-action";

export function PasteNotes() {
  const [text, setText] = useState("");
  const [run, setRun] = useState<N2AProposal | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function propose() {
    setMsg("Reading…");
    const res = await fetch("/api/n2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; run?: N2AProposal };
    if (!body.ok || !body.run) {
      setMsg(body.error ?? "Failed");
      return;
    }
    setRun(body.run);
    setMsg("Proposal only — nothing written, nothing sent.");
  }

  async function confirm() {
    if (!run) return;
    setMsg("Creating Gmail drafts…");
    const res = await fetch("/api/n2a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmId: run.id }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; run?: N2AProposal };
    if (!body.ok || !body.run) {
      setMsg(body.error ?? "Failed");
      return;
    }
    setRun(body.run);
    setMsg("Drafts parked in Gmail. Nothing sent.");
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Paste the Meet transcript, Gemini notes, or a WhatsApp thread. One blob. I will infer the rest."
        style={{ width: "100%", fontSize: 14, padding: 8 }}
      />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={text.length < 40} onClick={propose}>
          Propose actions
        </button>
        {run && !run.confirmed ? (
          <button type="button" className="btn" onClick={confirm}>
            Confirm — create Gmail drafts
          </button>
        ) : null}
      </div>
      {msg ? <p className="faint">{msg}</p> : null}
      {run ? (
        <div className="where" style={{ marginTop: 12 }}>
          <p>{run.summary}</p>
          <ul className="sub" style={{ paddingLeft: 18 }}>
            {run.verdicts.map((v) => (
              <li key={v.mandate}>
                {v.mandate}: {v.verdict}
                {v.reason ? ` — ${v.reason}` : ""}
              </li>
            ))}
          </ul>
          {run.drafts.map((d) => (
            <div key={d.id} className="where-card">
              <h3>
                {d.kind} → {d.to}
              </h3>
              <div>{d.subject}</div>
              {d.attachMarker ? <div className="faint">{d.attachMarker}</div> : null}
              {d.gmailDraftId ? <div className="faint">Gmail draft {d.gmailDraftId}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
