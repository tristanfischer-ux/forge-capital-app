"use client";

import { useState, useTransition } from "react";
import { updateCampaignPartnerStatus } from "@/app/(authed)/tracker/actions";
import { STATUS_CODES } from "@/lib/status-codes";

export function RaiseStatusForm({
  campaignPartnerId,
  currentCode,
}: {
  campaignPartnerId: string;
  currentCode: string | null;
}) {
  const [code, setCode] = useState(currentCode ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      style={{ marginTop: 8, display: "grid", gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const res = await updateCampaignPartnerStatus({
            campaignPartnerId,
            statusCode: code || null,
            commentary: note || null,
          });
          setMsg(res.ok ? "Saved" : res.error);
          if (res.ok) setNote("");
        });
      }}
    >
      <select
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={{ fontSize: 12, padding: "4px 6px" }}
      >
        <option value="">No status</option>
        {STATUS_CODES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.code} {s.label}
          </option>
        ))}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        style={{ fontSize: 12, padding: "4px 6px" }}
      />
      <button type="submit" className="btn-gmail" disabled={pending} style={{ fontSize: 12 }}>
        {pending ? "Saving…" : "Save status"}
      </button>
      {msg ? <div className="side-sub">{msg}</div> : null}
    </form>
  );
}
