"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { verifyBookPerson } from "../send/book-actions";

export function VerifyEmailButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="btn-row">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await verifyBookPerson(personId);
          setBusy(false);
          setMsg(result.ok ? result.badge : result.error ?? "Verify failed");
          router.refresh();
        }}
      >
        Verify with NeverBounce
      </button>
      {msg ? <span className="faint">{msg}</span> : null}
    </div>
  );
}
