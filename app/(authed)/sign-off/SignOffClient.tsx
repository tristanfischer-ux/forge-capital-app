"use client";

import { useMemo, useState } from "react";
import { applyVerdictPaste, createSignOffDraft, type SignOffLine } from "./actions";
import type { MandateCode } from "@/lib/capital/mandates";

export function SignOffClient({
  code,
  principal,
  lines,
}: {
  code: MandateCode;
  principal: string;
  lines: SignOffLine[];
}) {
  const [pasted, setPasted] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () =>
      lines.map((l) => `${l.n}. ${l.firmName}${l.website ? ` — ${l.website}` : ""}`).join("\n"),
    [lines],
  );

  async function draft() {
    setBusy(true);
    setMsg(null);
    const result = await createSignOffDraft({ mandateCode: code, principal, lines });
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setMsg("Gmail draft created for you to forward. Nothing was sent.");
    window.open(result.gmailUrl, "_blank", "noopener,noreferrer");
  }

  async function apply() {
    setBusy(true);
    setMsg(null);
    const result = await applyVerdictPaste({
      mandateCode: code,
      principal,
      pasted,
      lines,
    });
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setMsg(`Applied ${result.updated} verdicts. Reasons are on each firm.`);
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Ask {principal || "the principal"}</h2>
        <p className="sub">
          Numbered list in their format. Create a Gmail draft to yourself and
          forward it. They never log in.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{preview || "No firms awaiting sign-off."}</pre>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy || lines.length === 0} onClick={draft}>
            Create Gmail draft
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Paste the reply</h2>
        <p className="sub">1 = fine, 2 = cautious, blank = leave it. Reasons are kept.</p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={12}
          style={{ width: "100%", fontSize: 14, padding: 10 }}
          placeholder={"1 = fine\n2 = cautious — met them in Bordeaux\n3 ="}
        />
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy || !pasted.trim()} onClick={apply}>
            Apply verdicts
          </button>
        </div>
        {msg ? <p className="note">{msg}</p> : null}
      </div>
    </div>
  );
}
