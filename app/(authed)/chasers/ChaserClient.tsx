"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MandateCode } from "@/lib/capital/mandates";
import { createChaserDraft } from "./actions";
import type { ChaserRow } from "@/lib/capital/chasers";

export function ChaserClient({
  code,
  days,
  rows,
}: {
  code: MandateCode;
  days: number;
  rows: ChaserRow[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function chase(row: ChaserRow) {
    setBusy(row.participationId);
    setMsg(null);
    const result = await createChaserDraft({
      participationId: row.participationId,
      mandateCode: code,
    });
    setBusy(null);
    if (!result.ok) {
      setMsg(result.error);
      return;
    }
    setMsg(`Chaser draft for ${row.personName} is in Gmail. Nothing was sent.`);
    window.open(result.gmailUrl, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  return (
    <div className="card">
      {msg ? <p className="note">{msg}</p> : null}
      {rows.length === 0 ? (
        <p className="sub">
          Nobody on this raise has been quiet for {days} days. Quiet means you
          wrote and they have not replied.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Firm</th>
              <th>Quiet</th>
              <th>Last note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.participationId}>
                <td>
                  <a href={`/person/${r.personId}`}>{r.personName}</a>
                  <div className="faint">{r.email ?? "no email"}</div>
                </td>
                <td>{r.firmName}</td>
                <td>{r.quietDays} days</td>
                <td className="faint">{r.lastOutboundSubject ?? r.lastOutboundAt?.slice(0, 10)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy === r.participationId || r.emailState !== "verified"}
                    onClick={() => chase(r)}
                  >
                    {r.emailState !== "verified" ? "Verify first" : "Create chaser draft"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
