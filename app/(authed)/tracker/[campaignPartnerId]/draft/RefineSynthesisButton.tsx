"use client";

import { useState, useTransition } from "react";
import { refineSynthesisWithOpus } from "./refineSynthesisAction";

/**
 * "Refine synthesis with Opus" — regenerates the per-investor synthesis
 * paragraph using Opus 4.7 with the partner's firm name, thesis, sector,
 * and the campaign's voice reference email as context.
 *
 * Cached to `campaign_partners.rendered_synthesis`. The draft composer
 * reads that column (preferred over the template-token substitution
 * path) so the grammar-broken "focuses primarily on Pioneered..." stumble
 * gets replaced in-place.
 */
export function RefineSynthesisButton(props: {
  campaignPartnerId: string;
  hasRendered: boolean;
  renderedAt: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "done"; at: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onClick() {
    if (isPending) return;
    setState({ kind: "idle" });
    startTransition(async () => {
      const out = await refineSynthesisWithOpus({
        campaignPartnerId: props.campaignPartnerId,
      });
      if (out.ok) {
        setState({ kind: "done", at: new Date().toISOString() });
      } else {
        setState({ kind: "error", message: out.error });
      }
    });
  }

  const label = props.hasRendered ? "Refresh synthesis" : "Refine synthesis with Opus";
  const subline = props.hasRendered
    ? `Last refreshed ${props.renderedAt ? formatAge(props.renderedAt) : "some time ago"}`
    : "Template substitution can stumble on verb-leading theses. Opus writes a grammar-clean paragraph using this firm's actual thesis.";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        className="btn sm"
        onClick={onClick}
        disabled={isPending}
        style={{
          fontSize: 11,
          padding: "4px 10px",
          borderColor: "var(--accent)",
          color: "var(--accent)",
          background: "var(--accent-softer)",
          fontWeight: 600,
        }}
        title={subline}
      >
        {isPending ? "Refining with Opus…" : label}
      </button>
      {state.kind === "done" ? (
        <span style={{ fontSize: 11, color: "var(--green)" }}>
          ✓ Synthesis refreshed — reload the page to see the new paragraph.
        </span>
      ) : null}
      {state.kind === "error" ? (
        <span style={{ fontSize: 11, color: "var(--red)" }}>{state.message}</span>
      ) : null}
      {state.kind === "idle" ? (
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{subline}</span>
      ) : null}
    </div>
  );
}

function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "some time ago";
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
