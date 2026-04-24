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
  const [rankerModel, setRankerModel] = useState<
    "deepseek-v4-flash" | "haiku-4-5" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  // Pin-to-top so Tristan can compare 2-3 candidates side-by-side
  // without losing them in a long list (Tristan 2026-04-24:
  // "It would be useful to have the ability to click one you might
  // want to go for and then that jumps to the top").
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  // After the ranker completes, default to showing only the #1
  // candidate (plus any pinned) — Tristan 2026-04-24: "there should
  // only be one". The rest collapse behind a disclosure. We
  // automatically expand the list if the top candidate is generic
  // (info@, sales@) — in that case the named alternative at rank 2+
  // is probably the real answer and hiding it would be wrong.
  const [showAllCandidates, setShowAllCandidates] = useState(false);
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
        // replace with the model-ranked list once it returns.
        setCandidates(r.candidates);
        if (r.candidates.length === 0) {
          setError(
            `Hunter returned no emails for ${r.domain} (${r.organisation ?? firmName ?? "this firm"}). Hunter sometimes knows the domain but has no contacts indexed yet. Enter an email manually above if you have one, or skip this row for now.`,
          );
          return;
        }
        // Fire the role-fit ranker (DeepSeek Flash primary, Haiku fallback).
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
        setRankerModel(ranked.model);
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
          Checking who's the right person for this pitch…
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
          Role-fit ranker unavailable — showing Hunter's native order.
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
          ✓ Ranked by role-pitch fit{rankerModel === "haiku-4-5" ? " (Haiku fallback)" : ""}. Top
          candidates most likely the right person for your specific hook —
          pin & compare.
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
        (() => {
          const sorted = [...candidates].sort((a, b) => {
            const ap = pinned.has(a.email) ? 1 : 0;
            const bp = pinned.has(b.email) ? 1 : 0;
            if (ap !== bp) return bp - ap; // pinned first
            // Then ranker output when available (lower rank = better fit).
            const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
            const br = b.rank ?? Number.MAX_SAFE_INTEGER;
            if (ar !== br) return ar - br;
            return 0; // fall back to array order (Hunter's native ranking)
          });
          // Collapse-to-#1 only kicks in once the ranker has finished
          // successfully AND the top-ranked candidate is a named personal
          // address. Pre-rank or after a ranker failure, show the full
          // list — the user has no "one" to trust yet. If the top pick
          // is a generic (info@ / sales@), the rank-2+ named candidate
          // is usually the real answer and hiding it would be wrong.
          const topIsPersonal =
            rankingStatus === "done" &&
            sorted[0]?.rank != null &&
            sorted[0]?.type === "personal";
          const shouldCollapse = topIsPersonal && !showAllCandidates;
          const visible = shouldCollapse
            ? sorted.filter((c, idx) => idx === 0 || pinned.has(c.email))
            : sorted;
          const hiddenCount = sorted.length - visible.length;
          return (
            <>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {visible.map((c) => {
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
                    {c.rank != null ? (
                      <span
                        style={{
                          display: "inline-block",
                          marginRight: 6,
                          padding: "1px 5px",
                          fontSize: 9,
                          fontWeight: 700,
                          color: c.rank === 1 ? "white" : "var(--accent)",
                          background:
                            c.rank === 1
                              ? "var(--accent)"
                              : "var(--accent-softer)",
                          borderRadius: 3,
                          verticalAlign: 1,
                        }}
                        title={`Role-fit rank ${c.rank}${c.ranker_model ? ` (${c.ranker_model})` : ""}`}
                      >
                        #{c.rank}
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
                  {c.reason ? (
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
                      {c.reason}
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
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllCandidates(true)}
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-dim)",
                    background: "var(--surface)",
                    border: "1px dashed var(--border)",
                    borderRadius: 4,
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "center",
                  }}
                  title="Show the rest of the Hunter candidates for this firm"
                >
                  Show {hiddenCount} other{hiddenCount === 1 ? "" : "s"} ↓
                </button>
              ) : shouldCollapse === false && sorted.length > 1 && rankingStatus === "done" ? (
                <button
                  type="button"
                  onClick={() => setShowAllCandidates(false)}
                  style={{
                    marginTop: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-dim)",
                    background: "var(--surface)",
                    border: "1px dashed var(--border)",
                    borderRadius: 4,
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "center",
                  }}
                  title="Hide everything except the top-ranked candidate"
                >
                  Collapse to top pick ↑
                </button>
              ) : null}
            </>
          );
        })()
      ) : null}
    </div>
  );
}
