"use client";

import { useState, useTransition } from "react";
import { applyApprovalVerdicts, type Verdict } from "./actions";

/**
 * Step-3 row decision cell — UX audit 2026-04-23 item #12.
 *
 * Renders the decision badge (Approved / Flag / Reject) plus the
 * Haiku parse_confidence score as a coloured tier badge. When the
 * parser's confidence is below 0.60, a "Click to change" affordance
 * expands inline and lets Tristan reclassify the row into any of the
 * four canonical verdicts without leaving the page.
 *
 * Tiers:
 *   >= 0.85 → green
 *   0.60 .. 0.84 → amber
 *   < 0.60 → red, with inline override UI
 *   null → neutral pill ("no score") — row decided before migration
 *          028 landed or Haiku omitted the confidence field. No
 *          override UI in that case (we don't have an authoritative
 *          signal that it needs one); Tristan can still reclassify
 *          via the existing reply-parser drop zone.
 */

export interface IncomingDecisionCellProps {
  campaignId: string;
  campaignPartnerId: string;
  /** The current decision bucket, derived from status_code + evidence
   *  (see classifyDecision in lib/queries/approval.ts). */
  decision: "approved" | "flag" | "rejected";
  /** 0.0 – 1.0 or null for legacy rows. */
  parseConfidence: number | null;
}

type PendingVerdict = Verdict;

const VERDICT_OPTIONS: Array<{ value: PendingVerdict; label: string }> = [
  { value: "ok", label: "Approve → +1" },
  { value: "not_for_me", label: "Reject → −3" },
  { value: "skip", label: "Skip → −3 (with [SKIP] note)" },
  { value: "maybe", label: "Flag → +0 (with [FLAG] note)" },
];

export function IncomingDecisionCell({
  campaignId,
  campaignPartnerId,
  decision,
  parseConfidence,
}: IncomingDecisionCellProps) {
  const [isOverriding, setIsOverriding] = useState(false);
  const [chosen, setChosen] = useState<PendingVerdict | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PendingVerdict | null>(null);
  const [isSaving, startSave] = useTransition();

  const confidenceIsLow =
    parseConfidence !== null &&
    Number.isFinite(parseConfidence) &&
    parseConfidence < 0.6;

  function submitOverride() {
    if (!chosen) {
      setError("Pick one of the four verdicts first.");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await applyApprovalVerdicts({
        campaignId,
        verdicts: [
          {
            campaign_partner_id: campaignPartnerId,
            verdict: chosen,
            // Manual override — clear confidence so the row no longer
            // carries Haiku's questionable score.
            confidence: null,
          },
        ],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.failed.length > 0) {
        setError(result.failed[0].error);
        return;
      }
      setSaved(chosen);
      setIsOverriding(false);
    });
  }

  // After an override lands, optimistically reflect the chosen verdict
  // rather than the (stale) prop-level decision. A page revalidation
  // re-renders this row with the real value on the next navigation.
  const effectiveDecision: IncomingDecisionCellProps["decision"] =
    saved === "ok"
      ? "approved"
      : saved === "not_for_me" || saved === "skip"
        ? "rejected"
        : saved === "maybe"
          ? "flag"
          : decision;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <DecisionBadge decision={effectiveDecision} />
        <ConfidenceBadge confidence={parseConfidence} />
      </div>

      {saved ? (
        <span
          style={{
            fontSize: 10,
            color: "var(--green)",
            fontStyle: "italic",
          }}
        >
          overridden → {chosen}
        </span>
      ) : null}

      {confidenceIsLow && !saved ? (
        isOverriding ? (
          <div
            style={{
              marginTop: 2,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value as PendingVerdict)}
              disabled={isSaving}
              aria-label="Choose the correct verdict"
              style={{
                padding: "4px 6px",
                fontSize: 11,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface)",
                color: "var(--text)",
              }}
            >
              <option value="">Pick verdict…</option>
              {VERDICT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                onClick={submitOverride}
                disabled={isSaving || !chosen}
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "var(--accent-2)",
                  color: "#fff",
                  border: "none",
                  cursor: isSaving || !chosen ? "not-allowed" : "pointer",
                  opacity: isSaving || !chosen ? 0.6 : 1,
                }}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOverriding(false);
                  setError(null);
                  setChosen("");
                }}
                disabled={isSaving}
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "transparent",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  cursor: isSaving ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            </div>
            {error ? (
              <span style={{ fontSize: 10, color: "var(--red)" }}>
                {error}
              </span>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsOverriding(true)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 10,
              color: "var(--accent)",
              textDecoration: "underline dotted",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Click to change
          </button>
        )
      ) : null}
    </div>
  );
}

/* --------------------------- subcomponents ------------------------------ */

function DecisionBadge({
  decision,
}: {
  decision: IncomingDecisionCellProps["decision"];
}) {
  if (decision === "approved") {
    return <span className="approve-y">&#10003; Approved</span>;
  }
  if (decision === "flag") {
    return (
      <span style={{ color: "var(--amber)", fontWeight: 700 }}>&#9888; Flag</span>
    );
  }
  return <span className="approve-no">&#10007; Reject</span>;
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || !Number.isFinite(confidence)) {
    return (
      <span
        title="No confidence score recorded for this row. The parser either pre-dated the score column or didn't return one."
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "1px 6px",
          borderRadius: 10,
          background: "var(--surface-alt)",
          color: "var(--text-dim)",
          border: "1px solid var(--border-soft)",
          fontFamily: "'SF Mono', monospace",
        }}
      >
        no score
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  const tier =
    confidence >= 0.85 ? "high" : confidence >= 0.6 ? "review" : "low";
  const palette =
    tier === "high"
      ? { bg: "var(--green-light)", fg: "var(--green)", border: "#bbf7d0" }
      : tier === "review"
        ? { bg: "var(--amber-light)", fg: "var(--amber)", border: "#fde68a" }
        : { bg: "var(--red-light)", fg: "var(--red)", border: "#fecaca" };
  return (
    <span
      title={`Haiku parser confidence: ${pct}%`}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 10,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        fontFamily: "'SF Mono', monospace",
      }}
    >
      {pct}%
    </span>
  );
}
