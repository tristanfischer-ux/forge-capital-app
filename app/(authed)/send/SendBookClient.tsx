"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBookDraft, verifyBookPerson } from "./book-actions";
import type { MandateCode } from "@/lib/capital/mandates";

export type SendRow = {
  participationId: string;
  firmId: string | null;
  personId: string | null;
  firmName: string;
  personName: string;
  email: string | null;
  stage: string;
  emailState: string | null;
  badge: string;
  badgeClass: string;
  allowed: boolean;
  why: string;
  warm: boolean;
  lastSubject: string | null;
  collision: string | null;
};

export function SendBookClient({
  code,
  rows,
}: {
  code: MandateCode;
  rows: SendRow[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openers, setOpeners] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "unverified" | "draftable" | "warm" | "collision">(
    "all",
  );

  const visible = rows.filter((row) => {
    if (filter === "unverified") return row.emailState !== "verified" && Boolean(row.email);
    if (filter === "draftable") return row.allowed;
    if (filter === "warm") return row.warm;
    if (filter === "collision") return Boolean(row.collision);
    return true;
  });

  async function verify(row: SendRow) {
    if (!row.personId) return;
    setBusy(row.participationId);
    setMsg(null);
    const result = await verifyBookPerson(row.personId);
    setBusy(null);
    setMsg(
      result.ok
        ? `${row.personName}: ${result.badge}`
        : `${row.personName}: ${result.error ?? "verify failed"}`,
    );
    router.refresh();
  }

  async function draft(row: SendRow) {
    setBusy(row.participationId);
    setMsg(null);
    const result = await createBookDraft({
      participationId: row.participationId,
      mandateCode: code,
      opener: openers[row.participationId],
    });
    setBusy(null);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setMsg(`Draft created for ${row.personName}. It is in Gmail drafts — nothing was sent.`);
    window.open(result.gmailUrl, "_blank", "noopener,noreferrer");
  }

  async function verifyVisible() {
    const targets = visible.filter((r) => r.personId && r.email && r.emailState !== "verified").slice(0, 8);
    if (!targets.length) {
      setMsg("Nothing unverified in this filter.");
      return;
    }
    setBusy("bulk");
    setMsg(null);
    let ok = 0;
    for (const row of targets) {
      const result = await verifyBookPerson(row.personId as string);
      if (result.ok) ok += 1;
    }
    setBusy(null);
    setMsg(`Verified ${ok} of ${targets.length} — Gmail drafts still need a named, valid address.`);
    router.refresh();
  }

  return (
    <div className="card">
      {msg ? <p className="note">{msg}</p> : null}
      <div className="btn-row" style={{ padding: "12px 16px 0" }}>
        {(
          [
            ["all", "All"],
            ["draftable", "Draftable"],
            ["unverified", "Unverified"],
            ["warm", "Warm"],
            ["collision", "Collision"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "btn btn-primary" : "btn"}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn" disabled={busy !== null} onClick={verifyVisible}>
          Verify visible
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Firm</th>
            <th>Person</th>
            <th>Email</th>
            <th>Stage</th>
            <th>Verify</th>
            <th>May draft?</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.participationId}>
              <td>{row.firmName}</td>
              <td>
                {row.personId ? (
                  <a href={`/person/${row.personId}`}>{row.personName}</a>
                ) : (
                  row.personName
                )}
                {row.warm ? <div className="faint">Prior thread: {row.lastSubject ?? "yes"}</div> : null}
                {row.collision ? <div className="faint">{row.collision}</div> : null}
              </td>
              <td>{row.email ?? "—"}</td>
              <td>{row.stage}</td>
              <td>
                <span className={row.badgeClass}>{row.badge}</span>
              </td>
              <td>{row.allowed ? "Yes — Gmail draft only" : row.why}</td>
              <td>
                {row.warm ? (
                  <>
                    <textarea
                      value={openers[row.participationId] ?? ""}
                      onChange={(e) =>
                        setOpeners((s) => ({ ...s, [row.participationId]: e.target.value }))
                      }
                      placeholder="Reference the prior thread…"
                      rows={2}
                      style={{ width: 220, fontSize: 13, padding: 6, marginBottom: 6, display: "block" }}
                    />
                    {row.lastSubject ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginBottom: 6 }}
                        onClick={() =>
                          setOpeners((s) => ({
                            ...s,
                            [row.participationId]: `Good to be back in touch about ${row.lastSubject?.replace(/^re:\s*/i, "")}.`,
                          }))
                        }
                      >
                        Suggest opener
                      </button>
                    ) : null}
                  </>
                ) : null}
                {row.personId && row.emailState !== "verified" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === row.participationId}
                    onClick={() => verify(row)}
                  >
                    Verify
                  </button>
                ) : null}{" "}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === row.participationId || !row.allowed || (row.warm && !(openers[row.participationId] ?? "").trim())}
                  onClick={() => draft(row)}
                >
                  Create draft
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
