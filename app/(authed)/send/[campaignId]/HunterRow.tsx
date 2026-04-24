"use client";

import { useState, useTransition } from "react";
import {
  huntCandidatesForCampaignPartner,
  rankCandidatesForCampaignPartner,
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
  const [rankingStatus, setRankingStatus] = useState<
    "idle" | "ranking" | "done" | "failed"
  >("idle");
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  // Pin-to-top so Tristan can compare 2-3 candidates side-by-side
  // without losing them in a long list (Tristan 2026-04-24:
  // "It would be useful to have the ability to click one you might
  // want to go for and then that jumps to the top").
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  function togglePin(email: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function onOpen() {
    setExpanded(true);
    if (candidates !== null) return; // already fetched
    setLoading(true);
    setError(null);
    huntCandidatesForCampaignPartner(campaignPartnerId)
      .then(async (r) => {
        if (!r.ok) {
          setError(r.error);
          setCandidates([]);
          return;
        }
        // Show the raw list first so the user sees progress, then
        // replace with the Opus-ranked list once it returns.
        setCandidates(r.candidates);
        if (r.candidates.length === 0) {
          setError(
            `Hunter returned no emails for ${r.domain} (${r.organisation ?? firmName ?? "this firm"}). Hunter sometimes knows the domain but has no contacts indexed yet. Enter an email manually above if you have one, or skip this row for now.`,
          );
          return;
        }
        // Fire the Opus role-relevance ranker.
        setRankingStatus("ranking");
        setRankingError(null);
        const ranked = await rankCandidatesForCampaignPartner(
          campaignPartnerId,
          r.candidates,
        );
        if (!ranked.ok) {
          setRankingError(ranked.error);
          setRankingStatus("failed");
          return;
        }
        setCandidates(ranked.ranked);
        setRankingStatus("done");
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
      {rankingStatus === "ranking" ? (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            fontSize: 11,
            color: "var(--accent)",
            background: "var(--accent-softer)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
          }}
        >
          Asking Opus who's the right person for this pitch…
        </div>
      ) : rankingStatus === "failed" ? (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            fontSize: 11,
            color: "var(--text-dim)",
            background: "var(--surface-alt)",
            border: "1px dashed var(--border)",
            borderRadius: 4,
          }}
        >
          Opus ranker unavailable — showing Hunter's native order.
          {rankingError ? ` (${rankingError})` : ""}
        </div>
      ) : rankingStatus === "done" && candidates && candidates.length > 0 ? (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            fontSize: 11,
            color: "var(--accent)",
            background: "var(--accent-softer)",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            lineHeight: 1.4,
          }}
        >
          ✓ Opus ranked these by role-pitch fit. Top candidates most
          likely the right person for your specific hook — pin & compare.
        </div>
      ) : null}
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
          {[...candidates]
            .sort((a, b) => {
              const ap = pinned.has(a.email) ? 1 : 0;
              const bp = pinned.has(b.email) ? 1 : 0;
              if (ap !== bp) return bp - ap; // pinned first
              // Then Opus rank when available (lower rank = better fit).
              const ar = a.opus_rank ?? Number.MAX_SAFE_INTEGER;
              const br = b.opus_rank ?? Number.MAX_SAFE_INTEGER;
              if (ar !== br) return ar - br;
              return 0; // fall back to array order (Hunter's native ranking)
            })
            .map((c) => {
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
            const isPinned = pinned.has(c.email);
            return (
              <li
                key={c.email}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  padding: "6px 4px",
                  borderBottom: "1px solid var(--border-soft, var(--border))",
                  alignItems: "center",
                  background: isPinned
                    ? "var(--accent-softer)"
                    : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => togglePin(c.email)}
                  title={
                    isPinned
                      ? "Pinned to top — click to unpin"
                      : "Pin to top for comparison"
                  }
                  aria-label={isPinned ? "Unpin" : "Pin to top"}
                  style={{
                    padding: "2px 4px",
                    fontSize: 12,
                    lineHeight: 1,
                    color: isPinned ? "var(--accent)" : "var(--text-faint)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {isPinned ? "★" : "☆"}
                </button>
                <div style={{ minWidth: 0, fontSize: 11 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)" }}>
                    {c.opus_rank != null ? (
                      <span
                        style={{
                          display: "inline-block",
                          marginRight: 6,
                          padding: "1px 5px",
                          fontSize: 9,
                          fontWeight: 700,
                          color: c.opus_rank === 1 ? "white" : "var(--accent)",
                          background:
                            c.opus_rank === 1
                              ? "var(--accent)"
                              : "var(--accent-softer)",
                          borderRadius: 3,
                          verticalAlign: 1,
                        }}
                        title={`Opus rank ${c.opus_rank}`}
                      >
                        #{c.opus_rank}
                      </span>
                    ) : null}
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
                  {c.opus_reason ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        fontStyle: "italic",
                        lineHeight: 1.45,
                        marginTop: 4,
                        padding: "4px 8px",
                        background: "var(--surface)",
                        border: "1px solid var(--border-soft, var(--border))",
                        borderLeft: "3px solid var(--accent)",
                        borderRadius: 3,
                      }}
                    >
                      {c.opus_reason}
                    </div>
                  ) : null}
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
