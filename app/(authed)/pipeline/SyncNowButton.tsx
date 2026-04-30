"use client";

import { useState } from "react";

export function SyncNowButton() {
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">(
    "idle",
  );

  async function handleSync() {
    setStatus("syncing");
    try {
      const res = await fetch("/api/cron/gmail-sync", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ""}`,
        },
      });
      if (!res.ok) {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
        return;
      }
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <button
      type="button"
      className="btn-gmail"
      onClick={handleSync}
      disabled={status === "syncing"}
      style={{ fontSize: 11, marginLeft: 8 }}
      title="Trigger an immediate Gmail sync (same as the every-15-minute cron)."
    >
      {status === "syncing"
        ? "Syncing…"
        : status === "done"
          ? "Synced"
          : status === "error"
            ? "Failed"
            : "Sync now"}
    </button>
  );
}
