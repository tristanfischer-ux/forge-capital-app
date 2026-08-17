"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewActions({
  id,
  firmName,
}: {
  id: string;
  firmName: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const clean = (firmName ?? "").replace(/^\d+\s+/, "").replace(/\s+\*$/, "");

  async function act(disposition: "matched" | "excluded" | "local_stub") {
    setMsg("Saving…");
    const res = await fetch("/api/desk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        disposition,
        cleanFirm: disposition === "matched" ? clean : undefined,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    setMsg(body.ok ? "Saved" : body.error ?? "Failed");
    if (body.ok) router.refresh();
  }

  return (
    <div className="btn-row" style={{ margin: "6px 0 0" }}>
      <button type="button" className="btn" onClick={() => act("matched")}>
        Merge as {clean || "this firm"}
      </button>
      <button type="button" className="btn" onClick={() => act("local_stub")}>
        File as needs-contact
      </button>
      <button type="button" className="btn" onClick={() => act("excluded")}>
        Ignore
      </button>
      {msg ? <span className="faint">{msg}</span> : null}
    </div>
  );
}
