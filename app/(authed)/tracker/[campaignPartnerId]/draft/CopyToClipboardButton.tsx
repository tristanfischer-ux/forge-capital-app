"use client";

import { useState } from "react";

/**
 * Client-only clipboard copier. Phase 3 is clipboard-only — Gmail API
 * integration lands in Phase 4 per the Phase 3 brief.
 *
 * Behaviour:
 *   - On click: navigator.clipboard.writeText(fullText), then show a
 *     transient toast "Copied — paste into a new Gmail compose."
 *   - If the clipboard write fails (Safari permission edge case), show an
 *     error message rather than failing silently (per the "no silent error
 *     handling" rule in CLAUDE.md).
 */

interface CopyButtonProps {
  fullText: string;
}

export function CopyToClipboardButton({ fullText }: CopyButtonProps) {
  const [feedback, setFeedback] = useState<
    { kind: "idle" } | { kind: "copied" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setFeedback({ kind: "copied" });
      // Reset after a short delay — long enough to read, short enough that
      // rapid re-copies work on the same page load.
      window.setTimeout(() => setFeedback({ kind: "idle" }), 2600);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Clipboard unavailable — use Cmd+C manually.";
      setFeedback({ kind: "error", message });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-accent bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-dark"
        >
          Copy to Gmail-ready text
        </button>
        <a
          href="https://mail.google.com/mail/u/0/#inbox?compose=new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          Open Gmail compose ↗
        </a>
      </div>
      {feedback.kind === "copied" ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#bbf7d0] bg-green-light px-2.5 py-1 text-[11px] font-medium text-green"
        >
          <span aria-hidden>✓</span>
          Copied — paste into a new Gmail compose.
        </span>
      ) : null}
      {feedback.kind === "error" ? (
        <span
          role="status"
          className="rounded-md border border-[#fecaca] bg-red-light px-2.5 py-1 text-[11px] font-medium text-red"
        >
          {feedback.message}
        </span>
      ) : null}
    </div>
  );
}
