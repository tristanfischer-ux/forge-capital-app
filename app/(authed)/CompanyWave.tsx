"use client";

import { useState } from "react";
import type { WaveScreen } from "@/lib/desk/wave";

export function CompanyWave({
  campaignId,
  raise,
  principal,
  rows,
}: {
  campaignId: string;
  raise: string;
  principal: string | null;
  rows: WaveScreen[];
}) {
  const greens = rows.filter((r) => r.flag === "ok");
  const ambers = rows.filter((r) => r.flag === "amber");
  const reds = rows.filter((r) => r.flag === "red");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: "packet" | "drafts") {
    setBusy(true);
    setMsg(action === "packet" ? "Drafting the sign-off note…" : "Parking Gmail drafts…");
    const res = await fetch("/api/desk-wave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, action }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      to?: string;
      made?: number;
      failed?: number;
      gmailUrl?: string;
    };
    setBusy(false);
    if (!body.ok) {
      setMsg(body.error ?? "Failed");
      return;
    }
    if (action === "packet") {
      setMsg(`Sign-off draft for ${body.to} is in Gmail. Nothing sent.`);
      if (body.gmailUrl) window.open(body.gmailUrl, "_blank", "noreferrer");
    } else {
      setMsg(`${body.made ?? 0} drafts parked. ${body.failed ?? 0} failed. Nothing sent.`);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>This wave</h2>
      <p className="sub">
        Screen first. Green can go in a principal packet. Drafts park in
        Gmail — you send them. {principal ? `Principal on file: ${principal}.` : "No principal email on this raise."}
      </p>
      <div className="tiles" style={{ margin: "0 16px 12px" }}>
        <div className="tile">
          <div className="k">Clear</div>
          <div className="n">{greens.length}</div>
        </div>
        <div className="tile warn">
          <div className="k">Check</div>
          <div className="n">{ambers.length}</div>
        </div>
        <div className="tile bad">
          <div className="k">Hold</div>
          <div className="n">{reds.length}</div>
        </div>
      </div>
      <div className="btn-row" style={{ margin: "0 16px 12px" }}>
        <button type="button" className="btn" disabled={busy} onClick={() => act("packet")}>
          Draft sign-off for {raise}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act("drafts")}>
          Park drafts for +0 / +1 who are clear
        </button>
      </div>
      {msg ? <p className="sub">{msg}</p> : null}
      {reds.slice(0, 8).length > 0 ? (
        <p className="sub">
          Held: {reds.slice(0, 8).map((r) => `${r.name} (${r.reasons[0]})`).join(" · ")}
          {reds.length > 8 ? ` · +${reds.length - 8} more` : ""}
        </p>
      ) : null}
    </div>
  );
}
