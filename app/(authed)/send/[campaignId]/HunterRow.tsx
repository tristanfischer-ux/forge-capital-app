"use client";

import { useState, useTransition } from "react";
import {
  huntCandidatesForCampaignPartner,
  type HunterCandidate,
} from "./hunterAction";
import { setPartnerEmail } from "./actions";

/**
 * Inline "Find via Hunter" row used inside Step 5 of /send for any
 * customer partner that doesn't have an email on file. Click the
 * button → server action hits Hunter.io /v2/domain-search using the
 * customer's website → returns ranked candidates → Tristan clicks
 * "Use this" on one → saves to partner_email_overrides and flips
 * the row into the "Ready" section.
 */
export function HunterRow({
  campaignPartnerId,
  firmName,
  primaryPartnerId,
  onSaved,
  setToast,
}: {
  campaignPartnerId: string;
  firmName: string | null;
  primaryPartnerId: number | null;
  onSaved: (email: string) => void;
  setToast: (s: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<HunterCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savingEmail, setSavingEmail] = useState<string | null>(null);

  function onOpen() {
    setExpanded(true);
    if (candidates !== null) return; // already fetched
    setLoading(true);
    setError(null);
    huntCandidatesForCampaignPartner(campaignPartnerId)
      .then((r) => {
        if (!r.ok) {
          setError(r.error);
          setCandidates([]);
          return;
        }
        setCandidates(r.candidates);
        if (r.candidates.length === 0) {
          setError(
            `Hunter returned no emails for ${r.domain} (${r.organisation ?? firmName ?? "this firm"}). Hunter sometimes knows the domain but has no contacts indexed yet. Enter an email manually above if you have one, or skip this row for now.`,
          );
        }
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }

  function onUse(candidate: HunterCandidate) {
    if (!primaryPartnerId) {
      setToast(
        "No primary contact on this row — open the ContactPicker on /tracker to set one first.",
      );
      return;
    }
    setSavingEmail(candidate.email);
    startTransition(async () => {
      const r = await setPartnerEmail(primaryPartnerId, candidate.email);
      setSavingEmail(null);
      if (!r.ok) {
        setToast(`Error: ${r.error}`);
        return;
      }
      onSaved(candidate.email);
      setToast(
        `Saved ${candidate.email} as the primary contact for ${firmName ?? "this row"}.`,
      );
      setExpanded(false);
    });
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{
          padding: "4px 8px",
          fontSize: 10,
          fontWeight: 500,
          color: "var(--accent)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Find via Hunter →
      </button>
    );
  }

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        marginTop: 8,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface-alt)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--text-dim)",
          }}
        >
          Hunter candidates for {firmName ?? "this firm"}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Close ✕
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Asking Hunter…
        </div>
      ) : error ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.5,
            padding: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      ) : candidates && candidates.length > 0 ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {candidates.map((c) => {
            const ranking = [
              c.type === "personal" ? "personal" : "generic",
              c.confidence != null ? `score ${c.confidence}` : null,
              c.sources_count != null ? `${c.sources_count} sources` : null,
              c.verification_status,
            ]
              .filter(Boolean)
              .join(" · ");
            const name =
              [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
            return (
              <li
                key={c.email}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-soft, var(--border))",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0, fontSize: 11 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)" }}>
                    {c.email}{" "}
                    {name ? (
                      <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>
                        · {name}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-faint)",
                      marginTop: 2,
                    }}
                  >
                    {c.position ?? "no title"}
                    {c.department ? ` · ${c.department}` : ""}
                    {ranking ? ` · ${ranking}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUse(c)}
                  disabled={isPending && savingEmail === c.email}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "var(--surface)",
                    border: "1px solid var(--accent)",
                    borderRadius: 4,
                    cursor:
                      isPending && savingEmail === c.email
                        ? "wait"
                        : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isPending && savingEmail === c.email
                    ? "Saving…"
                    : "Use this →"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
