"use client";

import { useEffect, useMemo, useState } from "react";
import { MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";
import { OUTREACH_RAISES, type OutreachDraftRow } from "@/lib/capital/outreach-types";
import {
  createOutreachDrafts,
  huntOutreach,
  loadOutreach,
  reshapeOutreach,
} from "./actions";

type Working = {
  anchors: { firmId: string; firmName: string; stage: string; sectors: string | null }[];
  tokens: string[];
  note: string;
};

export function OutreachClient() {
  const [code, setCode] = useState<MandateCode>("SS");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [samples, setSamples] = useState<OutreachDraftRow[]>([]);
  const [hunted, setHunted] = useState<OutreachDraftRow[]>([]);
  const [instruction, setInstruction] = useState("");
  const [n, setN] = useState(20);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [shapeOk, setShapeOk] = useState(false);

  const rows = useMemo(() => [...samples, ...hunted], [samples, hunted]);

  useEffect(() => {
    void load("SS");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(next: MandateCode) {
    setBusy(true);
    setMsg(null);
    setCode(next);
    setHunted([]);
    setShapeOk(false);
    const result = await loadOutreach(next);
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setBlocked(result.blocked);
    setWorking(result.working);
    setSamples(result.samples);
    setPicked({});
  }

  async function hunt() {
    setBusy(true);
    setMsg(null);
    const result = await huntOutreach({ code, n, instruction });
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setHunted(result.rows);
    setMsg(`Found ${result.rows.length} lookalikes from the book. Unapproved firms will not draft.`);
  }

  async function reshape() {
    setBusy(true);
    const result = await reshapeOutreach({ code, instruction, rows });
    setBusy(false);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setSamples(result.rows.filter((r) => r.sample));
    setHunted(result.rows.filter((r) => !r.sample));
    setMsg("Remaining drafts rewritten with that instruction. Gmail drafts already parked are left alone.");
  }

  async function draftApproved() {
    const chosen = rows.filter((r) => picked[r.participationId] && r.body && r.stage === "approved");
    setBusy(true);
    const result = await createOutreachDrafts({ code, rows: chosen });
    setBusy(false);
    setMsg(
      `${result.created} drafts in Gmail. Nothing was sent. ${result.skipped} skipped.${
        result.errors[0] ? " " + result.errors[0] : ""
      }`,
    );
  }

  const draftable = rows.filter((r) => r.body && r.stage === "approved" && r.emailState === "verified");

  return (
    <div>
      <div className="btn-row" style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {OUTREACH_RAISES.map((c) => (
          <button
            key={c}
            type="button"
            className={code === c ? "btn btn-primary" : "btn"}
            disabled={busy}
            onClick={() => load(c as MandateCode)}
          >
            {MANDATE_LABEL[c]}
          </button>
        ))}
      </div>

      {blocked ? <div className="warn-banner">{blocked}</div> : null}
      {working ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>What has been working on {MANDATE_LABEL[code]}</h2>
          <p className="sub">{working.note}</p>
          {working.anchors.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Firm</th>
                  <th>Stage</th>
                  <th>Sectors</th>
                </tr>
              </thead>
              <tbody>
                {working.anchors.slice(0, 12).map((a) => (
                  <tr key={a.firmId}>
                    <td>{a.firmName}</td>
                    <td>{a.stage}</td>
                    <td className="faint">{a.sectors ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : (
        <p className="sub">Pick a raise. The first three drafts are for shape. Then you can hunt more.</p>
      )}

      {samples.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Shape sample — three approved, never written</h2>
          <p className="sub">
            Confirm the voice before a larger hunt. Distinct subjects. Block 3 is only what is
            already on the book.
          </p>
          {samples.map((r) => (
            <div key={r.participationId} className="blurb">
              <h2>
                {r.personName} · {r.firmName}
              </h2>
              <p className="faint">{r.email} · {r.emailState} · {r.thesisSource ?? "no thesis fact"}</p>
              {r.gateWhy ? <p className="note">{r.gateWhy}</p> : null}
              {r.subject ? <p><strong>{r.subject}</strong></p> : null}
              {r.body ? (
                <pre className="mail-body" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                  {r.body}
                </pre>
              ) : null}
            </div>
          ))}
          <div className="btn-row" style={{ padding: 16 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setShapeOk(true)}>
              This shape is right — hunt more
            </button>
          </div>
        </div>
      ) : working && !blocked ? (
        <p className="note">
          No approved, verified, never-written people on {MANDATE_LABEL[code]} to use as a shape
          sample. Approve names first (Sign-off in More), or hunt lookalikes as research only.
        </p>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Instruction for the next set</h2>
        <p className="sub">e.g. shorter, more on the thesis, drop the bio tone. Applies to undrafted rows only.</p>
        <div style={{ padding: 16 }}>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
            placeholder="Change the remaining drafts…"
          />
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || rows.length === 0} onClick={() => reshape()}>
              Rewrite remaining
            </button>
          </div>
        </div>
      </div>

      {shapeOk || samples.length === 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Find more</h2>
          <p className="sub">
            Default 20, max 50. Lookalikes from firms that already replied or met. Hunter/NeverBounce
            run only when you later fill an address. New firms without principal approval stay as
            research — a packet, not a letter.
          </p>
          <div className="btn-row" style={{ padding: 16 }}>
            <label className="faint">
              How many{" "}
              <input
                type="number"
                min={5}
                max={50}
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                style={{ width: 72, padding: 6 }}
              />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy || Boolean(blocked)} onClick={() => hunt()}>
              {busy ? "Looking…" : `Find ${n} lookalikes`}
            </button>
          </div>
        </div>
      ) : null}

      {hunted.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Review</h2>
          <p className="sub">
            Tick approved, verified rows then park Gmail drafts. Cap 25 per click. Nothing sends.
          </p>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Person</th>
                <th>Firm</th>
                <th>Why</th>
                <th>State</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {hunted.map((r) => (
                <tr key={r.participationId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(picked[r.participationId])}
                      disabled={!r.body || r.stage !== "approved" || r.emailState !== "verified"}
                      onChange={(e) =>
                        setPicked((p) => ({ ...p, [r.participationId]: e.target.checked }))
                      }
                    />
                  </td>
                  <td>
                    {r.personName}
                    <div className="faint">{r.email ?? "no email"}</div>
                  </td>
                  <td>{r.firmName}</td>
                  <td className="faint">{r.why}</td>
                  <td>
                    {r.stage}
                    {r.gateWhy ? <div className="faint">{r.gateWhy}</div> : null}
                    {r.needsResearch ? <div className="faint">needs research</div> : null}
                  </td>
                  <td>{r.subject ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row" style={{ padding: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || draftable.filter((r) => picked[r.participationId]).length === 0}
              onClick={() => draftApproved()}
            >
              Create Gmail drafts for ticked ({Math.min(25, draftable.filter((r) => picked[r.participationId]).length)})
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="note">{msg}</p> : null}
    </div>
  );
}
