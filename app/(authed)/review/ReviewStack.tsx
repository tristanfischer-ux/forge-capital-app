"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DraftReviewRow } from "@/lib/queries/review";
import { acceptDraft, discardDraft } from "./actions";

/**
 * Eyeball-review stack — V4 §5 client.
 *
 * DOM structure ported verbatim from Phase2-Mockup-V4.html lines 1545-1643:
 *   - `.er-keymap`   — keyboard cheat-sheet strip
 *   - `.er-stack`    — vertical flex column
 *   - `.er-draft`    — one card per draft (+.active on the focused card)
 *   - `.er-num`      — circular row-number chip
 *   - `.er-to`       — firm · partner · tier chip
 *   - `.er-subj`     — subject line
 *   - `.er-preview`  — first ~240 chars of the body
 *   - `.er-controls` — keyboard hint + `.er-btns` row
 *   - `.er-btn.ok | .edit | .discard` — three action buttons per row
 *
 * Keyboard handling (V4 lines 1537-1541):
 *   J / ArrowDown  → next draft
 *   K / ArrowUp    → previous draft
 *   A / Enter      → accept focused draft
 *   E              → edit → /tracker/<id>/draft
 *   D              → discard focused draft
 *
 * We deliberately scope the listener to `window` but no-op when the active
 * element is an input/textarea/contenteditable so the shortcuts don't fight
 * any future compose surface embedded on the page.
 */
export function ReviewStack({ drafts }: { drafts: DraftReviewRow[] }) {
  const router = useRouter();
  const [cursor, setCursor] = useState(0);
  const [pending, startTransition] = useTransition();
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  /** Drafts still awaiting a decision this session. */
  const remaining = useMemo(
    () => drafts.filter((d) => !processedIds.has(d.campaign_partner_id)),
    [drafts, processedIds],
  );

  // Clamp cursor whenever drafts shrink.
  useEffect(() => {
    if (cursor >= remaining.length && remaining.length > 0) {
      setCursor(remaining.length - 1);
    }
    if (remaining.length === 0 && cursor !== 0) {
      setCursor(0);
    }
  }, [remaining.length, cursor]);

  // Scroll the focused card into view when the cursor changes.
  useEffect(() => {
    const node = cardRefs.current[cursor];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [cursor]);

  const handleAccept = useCallback(
    (row: DraftReviewRow) => {
      setErrorMsg(null);
      startTransition(async () => {
        const res = await acceptDraft(row.campaign_partner_id);
        if (!res.ok) {
          setErrorMsg(res.error);
          return;
        }
        setProcessedIds((prev) => new Set(prev).add(row.campaign_partner_id));
        // Let Next.js rehydrate the server component so counts stay honest.
        router.refresh();
      });
    },
    [router],
  );

  const handleDiscard = useCallback(
    (row: DraftReviewRow) => {
      setErrorMsg(null);
      startTransition(async () => {
        const res = await discardDraft(row.campaign_partner_id);
        if (!res.ok) {
          setErrorMsg(res.error);
          return;
        }
        setProcessedIds((prev) => new Set(prev).add(row.campaign_partner_id));
        router.refresh();
      });
    },
    [router],
  );

  const handleEdit = useCallback(
    (row: DraftReviewRow) => {
      router.push(`/tracker/${row.campaign_partner_id}/draft`);
    },
    [router],
  );

  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (remaining.length === 0) return;

      const key = e.key.toLowerCase();
      const active = remaining[cursor];

      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, remaining.length - 1));
        return;
      }
      if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (!active || pending) return;

      if (key === "a" || e.key === "Enter") {
        e.preventDefault();
        handleAccept(active);
        return;
      }
      if (key === "e") {
        e.preventDefault();
        handleEdit(active);
        return;
      }
      if (key === "d") {
        e.preventDefault();
        handleDiscard(active);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, remaining, handleAccept, handleDiscard, handleEdit, pending]);

  const reviewedCount = processedIds.size;
  const totalCount = drafts.length;

  return (
    <>
      {/* V4 lines 1535-1543: `.er-keymap` cheat-sheet strip. Copy matches V4
          verbatim except the "Reviewed so far" counter, which is live. */}
      <div className="er-keymap">
        <div>
          <b>Keyboard:</b>
        </div>
        <div>
          <kbd>J</kbd> / <kbd>K</kbd> next / previous
        </div>
        <div>
          <kbd>Enter</kbd> accept &rarr; send from Gmail
        </div>
        <div>
          <kbd>E</kbd> edit inline
        </div>
        <div>
          <kbd>D</kbd> discard + log reason
        </div>
        <div style={{ marginLeft: "auto", color: "var(--accent)", fontWeight: 600 }}>
          Reviewed so far: {reviewedCount} of {totalCount}
        </div>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          style={{
            margin: "0 0 10px 0",
            padding: "8px 12px",
            background: "var(--red-light)",
            border: "1px solid #fecaca",
            borderRadius: 8,
            color: "var(--red)",
            fontSize: 12,
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      {remaining.length === 0 ? (
        <AllDoneState totalReviewed={reviewedCount} totalCount={totalCount} />
      ) : (
        <div className="er-stack">
          {remaining.map((row, idx) => (
            <DraftCard
              key={row.campaign_partner_id}
              ref={(el) => {
                cardRefs.current[idx] = el;
              }}
              row={row}
              index={idx}
              isActive={idx === cursor}
              isFirst={idx === 0}
              isLast={idx === remaining.length - 1}
              pending={pending}
              onAccept={() => handleAccept(row)}
              onEdit={() => handleEdit(row)}
              onDiscard={() => handleDiscard(row)}
              onFocus={() => setCursor(idx)}
            />
          ))}
        </div>
      )}
    </>
  );
}

const tierChipColour = (tier: DraftReviewRow["email_tier"]): string => {
  if (tier === "corresponded" || tier === "hunter_verified") return "var(--green)";
  if (tier === "generic_blocked" || tier === "bounced") return "var(--red)";
  return "var(--text-dim)";
};

const tierChipLabel = (tier: DraftReviewRow["email_tier"]): string => {
  if (tier === "corresponded") return "✓ Corresponded";
  if (tier === "hunter_verified") return "✓ Hunter verified";
  if (tier === "generic_blocked") return "⚠ Generic address";
  if (tier === "bounced") return "⚠ Bounced";
  if (tier === "unverified") return "⚠ Unverified";
  return "— no tier";
};

interface DraftCardProps {
  ref: React.Ref<HTMLDivElement>;
  row: DraftReviewRow;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onFocus: () => void;
}

/**
 * One `.er-draft` card — V4 lines 1547-1603 structure. We render the
 * `.active` variant on the cursor row. `.flagged` is reserved for the
 * voice-rules scanner output (V4 line 1581) which we do not implement in
 * V1 — the scanner lands in Phase 6 alongside the compose surface.
 */
function DraftCard({
  ref,
  row,
  index,
  isActive,
  isFirst,
  isLast,
  pending,
  onAccept,
  onEdit,
  onDiscard,
  onFocus,
}: DraftCardProps) {
  const blockedTier =
    row.email_tier === "generic_blocked" ||
    row.email_tier === "bounced" ||
    row.email_tier === "unverified";

  const hintText = isActive
    ? "← you are here"
    : isFirst
      ? "current · J to move"
      : isLast
        ? "next · K to go back"
        : "J/K to move";

  return (
    <div
      ref={ref}
      className={isActive ? "er-draft active" : "er-draft"}
      onMouseDown={onFocus}
      role="article"
      aria-current={isActive ? "true" : undefined}
    >
      <div className="er-num">{index + 1}</div>
      <div>
        <div className="er-to">
          <b>{row.partner_name ?? "— unnamed partner"}</b>
          {row.firm_name ? <> &middot; {row.firm_name}</> : null}
          {row.partner_title ? (
            <>
              {" "}
              &middot;{" "}
              <span style={{ color: "var(--text-faint)" }}>{row.partner_title}</span>
            </>
          ) : null}
          {" "}&middot;{" "}
          <span style={{ color: tierChipColour(row.email_tier) }}>
            {tierChipLabel(row.email_tier)}
          </span>
        </div>
        <div className="er-subj">
          {row.subject_preview ?? (
            <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
              Subject derives from the campaign email template — not yet on file.
            </span>
          )}
        </div>
        <div className="er-preview">
          {row.body_preview ?? (
            <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
              No body preview available — open the full draft page to render with
              the live campaign template.
            </span>
          )}
        </div>
      </div>
      <div className="er-controls">
        <span className="er-kbd">{hintText}</span>
        <div className="er-btns">
          <button
            type="button"
            className="er-btn ok"
            onClick={onAccept}
            disabled={pending || blockedTier}
            title={
              blockedTier
                ? "Deliverability tier blocks send — resolve in the full draft view."
                : "Accept (A / Enter) — marks +3 Email sent."
            }
            style={blockedTier ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
          >
            &#10003; Accept
          </button>
          <button
            type="button"
            className="er-btn edit"
            onClick={onEdit}
            disabled={pending}
            title="Edit (E) — opens the full draft page."
          >
            Edit
          </button>
          <button
            type="button"
            className="er-btn discard"
            onClick={onDiscard}
            disabled={pending}
            title="Discard (D) — reverts to +1 Approved for regeneration."
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

function AllDoneState({
  totalReviewed,
  totalCount,
}: {
  totalReviewed: number;
  totalCount: number;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "28px 24px",
        boxShadow: "var(--shadow)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: "var(--green-light)",
          color: "var(--green)",
          marginBottom: 10,
          fontSize: 18,
          fontWeight: 700,
        }}
        aria-hidden="true"
      >
        &#10003;
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {totalCount === 0
          ? "No drafts at +2 for this campaign."
          : `Reviewed ${totalReviewed} of ${totalCount} — stack cleared.`}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-dim)",
          marginTop: 6,
          maxWidth: 520,
          margin: "6px auto 0",
          lineHeight: 1.55,
        }}
      >
        {totalCount === 0 ? (
          <>
            The stack shows rows at <b>+2 Drafted — ready to send</b>. Generate
            drafts in the approval flow (Phase 4) and they will appear here for
            keyboard-driven review.
          </>
        ) : (
          <>
            New drafts will appear here as the approval flow advances partners to
            <b> +2 Drafted</b>. Open the{" "}
            <a
              href="/tracker"
              style={{ color: "var(--accent)", textDecoration: "underline dotted" }}
            >
              tracker
            </a>{" "}
            to see what happened next.
          </>
        )}
      </div>
    </div>
  );
}
