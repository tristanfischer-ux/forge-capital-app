"use client";

import { useState } from "react";
import {
  createSuggestedDrafts,
  importGeminiNotes,
  saveCallNotes,
} from "./actions";
import type { NotesCommitResult } from "@/lib/capital/notes-book";

export function NotesClient({
  geminiFiles,
  needsDriveScope,
}: {
  geminiFiles: { id: string; name: string; modified: string }[];
  needsDriveScope: boolean;
}) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<NotesCommitResult | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await saveCallNotes({ text });
    setBusy(false);
    setSaved(res.result);
    setMsg(
      res.result.personId || res.result.firmId
        ? "Notes written to the book. Review the suggested drafts below — nothing was sent."
        : "Notes saved. Could not match a person or firm — add a name or email in the paste.",
    );
  }

  async function drafts() {
    if (!saved?.drafts.length) return;
    setBusy(true);
    const res = await createSuggestedDrafts(saved.drafts);
    setBusy(false);
    setMsg(
      res.ok
        ? `${res.created} Gmail drafts created (thank-you and follow-ups). Nothing sent.`
        : res.error,
    );
  }

  async function gemini() {
    setBusy(true);
    setMsg(null);
    const res = await importGeminiNotes();
    setBusy(false);
    if (res.needsDriveScope) {
      setMsg("Reconnect Google with Drive read access to import Gemini notes automatically.");
      return;
    }
    setMsg(`Imported ${res.ingested} Gemini notes. Skipped ${res.skipped}.`);
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Dump call notes</h2>
        <p className="sub">
          Paste a Meet transcript, Gemini notes, or your own bullets. The book
          stores facts on the investor and the company so the pitch improves.
          All eight raises are scanned.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontSize: 14, padding: 10 }}
          placeholder="Paste the transcript or notes…"
        />
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy || text.length < 40} onClick={save}>
            Save to the book
          </button>
          {saved?.drafts.length ? (
            <button type="button" className="btn" disabled={busy} onClick={drafts}>
              Create thank-you and follow-up drafts
            </button>
          ) : null}
        </div>
        {msg ? <p className="note">{msg}</p> : null}
        {saved?.drafts.length ? (
          <ul className="sub">
            {saved.drafts.map((d, i) => (
              <li key={i}>
                {d.kind}
                {d.mandate ? ` · ${d.mandate}` : ""} → {d.to}: {d.subject}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="card">
        <h2>Gemini call notes</h2>
        <p className="sub">
          Notes by Gemini from Google Meet. Import writes them to the same
          book as a paste, then you can draft the thank-you.
        </p>
        {needsDriveScope ? (
          <p className="warn-banner">
            Google Drive is not on the current login.{" "}
            <a href="/api/auth/gmail">Reconnect Google</a> so the desk can
            read Meet notes. Until then, paste the transcript on the left.
          </p>
        ) : (
          <>
            <ul className="sub">
              {geminiFiles.slice(0, 8).map((f) => (
                <li key={f.id}>
                  {f.name}
                  <div className="faint">{f.modified.slice(0, 16).replace("T", " ")}</div>
                </li>
              ))}
            </ul>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={gemini}>
                Import latest Gemini notes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
