"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { duplicateTemplate } from "./actions";

/**
 * Client button that duplicates the current template for variant testing.
 * Calls the `duplicateTemplate` server action and refreshes the page on
 * success. Renders inline in the template footer strip.
 */
export function DuplicateTemplateButton({
  campaignId,
}: {
  campaignId: string;
}) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setPending(true);
    setMsg(null);
    const result = await duplicateTemplate({ campaignId });
    setPending(false);
    if ("ok" in result && result.ok) {
      setMsg("Duplicated");
      router.refresh();
      setTimeout(() => setMsg(null), 2000);
    } else if ("error" in result) {
      setMsg(result.error);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="btn-gmail"
        onClick={handleClick}
        disabled={pending}
        title="Create a copy of this template for variant testing"
        style={{ fontSize: 11 }}
      >
        {pending ? "Duplicating…" : "Duplicate"}
      </button>
      {msg ? (
        <span
          style={{
            fontSize: 10,
            color: msg === "Duplicated" ? "var(--green)" : "var(--red)",
          }}
        >
          {msg}
        </span>
      ) : null}
    </span>
  );
}
