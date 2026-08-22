"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MANDATE_CODES, MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";
import { mandateCaption, type ChaserRow } from "@/lib/capital/chasers";
import { createBookDraft } from "../send/book-actions";
import { createChaserDraft, createChaserDraftsBatch } from "./actions";

const BULK_CAP = 25;

export function ChaserClient({
  days,
  rows,
  view,
  code,
  allQuiet,
  counts,
}: {
  days: number;
  rows: ChaserRow[];
  view: "quiet" | "never" | "unverified";
  code: MandateCode | "ALL";
  allQuiet: number;
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const draftable = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.kind === "quiet" &&
          r.emailState === "verified" &&
          !r.paused &&
          Boolean(r.email),
      ),
    [rows],
  );
  const batch = draftable.slice(0, BULK_CAP);

  async function chase(row: ChaserRow) {
    setBusy(row.participationId);
    setMsg(null);
    const result =
      row.kind === "never"
        ? await createBookDraft({
            participationId: row.participationId,
            mandateCode: row.mandateCode,
          })
        : await createChaserDraft({
            participationId: row.participationId,
            mandateCode: row.mandateCode,
            lastSubject: row.lastOutboundSubject,
            lastOccurredAt: row.lastOutboundAt,
          });
    setBusy(null);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setMsg(
      row.kind === "never"
        ? `Opener draft for ${row.personName} is in Gmail. Nothing was sent.`
        : `Chaser draft for ${row.personName} is in Gmail. Nothing was sent.`,
    );
    window.open(result.gmailUrl, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  async function bulk() {
    setBusy("bulk");
    setMsg(null);
    const result = await createChaserDraftsBatch({
      items: batch.map((r) => ({
        participationId: r.participationId,
        mandateCode: r.mandateCode,
        lastSubject: r.lastOutboundSubject,
        lastOccurredAt: r.lastOutboundAt,
      })),
    });
    setBusy(null);
    const extra = result.errors.length ? ` ${result.errors[0]}` : "";
    setMsg(
      `${result.created} drafts in Gmail. Nothing was sent. ${result.skipped} skipped.${extra}`,
    );
    router.refresh();
  }

  function href(next: { view?: string; code?: string }) {
    const params = new URLSearchParams();
    params.set("days", String(days));
    params.set("view", next.view ?? view);
    const nextCode = next.code ?? code;
    if (nextCode && nextCode !== "ALL") params.set("code", nextCode);
    return `/chasers?${params.toString()}`;
  }

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <a className={view === "quiet" && code === "ALL" ? "btn btn-primary" : "btn"} href={href({ view: "quiet", code: "ALL" })}>
          All programmes ({allQuiet})
        </a>
        <a className={view === "never" ? "btn btn-primary" : "btn"} href={href({ view: "never", code: "ALL" })}>
          Never written
        </a>
        <a className={view === "unverified" ? "btn btn-primary" : "btn"} href={href({ view: "unverified", code: "ALL" })}>
          Unverified
        </a>
        {MANDATE_CODES.map((c) => (
          <a
            key={c}
            className={code === c ? "btn btn-primary" : "btn"}
            href={href({ code: c })}
          >
            {MANDATE_LABEL[c]}
            {typeof counts[c] === "number" ? ` (${counts[c]})` : ""}
          </a>
        ))}
      </div>

      {view === "quiet" ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="sub" style={{ paddingLeft: 16, paddingRight: 16 }}>
            {draftable.length} verified and draftable
            {draftable.length > BULK_CAP
              ? ` · this click creates ${batch.length}, then you can do the next ${BULK_CAP}`
              : ""}
            . HO is paused. Nothing sends.
          </p>
          <div className="btn-row" style={{ padding: "0 16px 16px" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null || batch.length === 0}
              onClick={() => bulk()}
            >
              {busy === "bulk"
                ? "Creating drafts…"
                : `Create follow-up drafts for verified (${batch.length})`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        {msg ? <p className="note">{msg}</p> : null}
        {rows.length === 0 ? (
          <p className="sub">
            {view === "never"
              ? "Nobody on the book is approved or in research with no outbound yet."
              : view === "unverified"
                ? "Nobody on this list is unverified."
                : code === "ALL"
                  ? `0 people quiet ≥${days} days across all programmes.`
                  : `0 quiet on ${mandateCaption(code)}. All programmes has ${allQuiet.toLocaleString("en-GB")} — open All programmes.`}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Firm</th>
                <th>Programme</th>
                <th>Quiet</th>
                <th>Last note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.participationId}-${r.mandateCode}`}>
                  <td>
                    <a href={`/person/${r.personId}`}>{r.personName}</a>
                    <div className="faint">{r.email ?? "no email"}</div>
                  </td>
                  <td>{r.firmName}</td>
                  <td>
                    {mandateCaption(r.mandateCode)}
                    {r.kind === "never" ? (
                      <div className="faint">never written</div>
                    ) : null}
                  </td>
                  <td>
                    {r.kind !== "quiet"
                      ? "—"
                      : r.quietDays >= 900
                        ? "no dated send"
                        : `${r.quietDays} days`}
                  </td>
                  <td className="faint">
                    {r.lastOutboundSubject ?? r.lastOutboundAt?.slice(0, 10) ?? "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        busy === r.participationId ||
                        r.emailState !== "verified" ||
                        r.paused
                      }
                      onClick={() => chase(r)}
                    >
                      {r.paused
                        ? "Paused"
                        : r.emailState !== "verified"
                          ? "Verify first"
                          : r.kind === "never"
                            ? "Create opener draft"
                            : "Create chaser draft"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
