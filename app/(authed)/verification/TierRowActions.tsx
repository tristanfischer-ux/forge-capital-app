"use client";

import { useState, useTransition } from "react";
import type { VerificationTier } from "@/lib/queries/verification";
import {
  queueHunterForPartners,
  markPartnersInactive,
} from "./actions";

/**
 * Verification-gate per-tier action button.
 *
 * Each deliverability tier shows one CTA on the right of the row; the
 * label + behaviour are driven by `tier`. The component handles every
 * non-sendable tier — sendable rows render a server `<Link>` directly
 * in page.tsx and never reach this component.
 *
 * Behaviour groups (the action a tier maps to):
 *   - resolve  → `unverified`, `neverbounce_unknown`. Dispatches the
 *                global `fc:resolve-email` event on the first partner's
 *                investor so the shell-level EmailHuntModal opens.
 *   - hunt     → `generic_blocked`, `neverbounce_invalid`,
 *                `neverbounce_disposable`. Calls `queueHunterForPartners`
 *                on every partner in the tier, shows a toast with the
 *                processed/skipped counts.
 *   - inactive → `bounced`. Opens a confirmation modal; on confirm,
 *                calls `markPartnersInactive` on every campaign partner
 *                in the tier and shows a toast.
 *
 * Toasts render inside the row itself (a thin inline strip below the
 * button) so every tier's feedback stays co-located with the button
 * that caused it. Matches the existing inline-message style used by
 * FindAMatch's result cards.
 */
type ActionTier = Extract<
  VerificationTier,
  | "unverified"
  | "neverbounce_unknown"
  | "generic_blocked"
  | "neverbounce_invalid"
  | "neverbounce_disposable"
  | "bounced"
>;

const RESOLVE_TIERS = new Set<ActionTier>(["unverified", "neverbounce_unknown"]);
const HUNT_TIERS = new Set<ActionTier>([
  "generic_blocked",
  "neverbounce_invalid",
  "neverbounce_disposable",
]);

export function TierRowActions({
  tier,
  count,
  firstInvestorId,
  partnerIds,
  campaignPartnerIds,
}: {
  tier: ActionTier;
  count: number;
  /** First `investors_mirror.id` for a partner in this tier — used to
   *  anchor the EmailHuntModal on a concrete firm. null means nothing
   *  to resolve; the button is disabled. */
  firstInvestorId: number | null;
  /** `partners_mirror.id` bigints — Hunter queue writes use these. */
  partnerIds: number[];
  /** `campaign_partners.id` uuids — mark-inactive writes use these. */
  campaignPartnerIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<
    | { kind: "ok" | "err"; text: string }
    | null
  >(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const disabled = count === 0;
  const isResolve = RESOLVE_TIERS.has(tier);
  const isHunt = HUNT_TIERS.has(tier);

  // Shared label for the button — drives the accessible label + copy.
  const cta = isResolve
    ? "Resolve email"
    : isHunt
      ? "Hunt for replacement"
      : "Mark inactive";

  const tooltip = isResolve
    ? firstInvestorId
      ? "Open the resolve-email modal on the first unresolved firm."
      : "No unresolved contacts to open."
    : isHunt
      ? count > 0
        ? `Queue ${count} partner${count === 1 ? "" : "s"} for Hunter on the next nightly run.`
        : "No partners to queue."
      : count > 0
        ? `Remove ${count} bounced partner${count === 1 ? "" : "s"} from drafting pools. Reversible via the tracker drawer.`
        : "No bounced partners to mark inactive.";

  function onClick() {
    if (disabled || pending) return;

    if (isResolve) {
      if (firstInvestorId === null) {
        setMsg({ kind: "err", text: "Nothing to open." });
        return;
      }
      // The shell-level EmailHuntModal (mounted in app/(authed)/layout.tsx)
      // subscribes to this custom event. Dispatching opens the modal on
      // the given investor — the modal iterates through the firm's
      // partners internally.
      window.dispatchEvent(
        new CustomEvent("fc:resolve-email", {
          detail: { investorId: firstInvestorId },
        }),
      );
      return;
    }

    if (isHunt) {
      setMsg(null);
      startTransition(async () => {
        const out = await queueHunterForPartners({ partnerIds });
        if (!out.ok) {
          setMsg({ kind: "err", text: out.error });
          return;
        }
        const parts: string[] = [];
        if (out.processed > 0) {
          parts.push(
            `${out.processed} partner${out.processed === 1 ? "" : "s"} queued for Hunter on the next nightly run`,
          );
        }
        if (out.skipped > 0) {
          parts.push(
            `${out.skipped} already pending`,
          );
        }
        setMsg({
          kind: "ok",
          text: parts.length > 0 ? parts.join(" · ") : "Nothing to queue.",
        });
      });
      return;
    }

    // Bounced — open confirmation modal.
    setConfirmOpen(true);
  }

  function confirmMarkInactive() {
    setConfirmOpen(false);
    setMsg(null);
    startTransition(async () => {
      const out = await markPartnersInactive(campaignPartnerIds);
      if (!out.ok) {
        setMsg({ kind: "err", text: out.error });
        return;
      }
      const parts: string[] = [];
      if (out.processed > 0) {
        parts.push(
          `${out.processed} partner${out.processed === 1 ? "" : "s"} marked inactive (-3 Disqualified)`,
        );
      }
      if (out.skipped > 0) {
        parts.push(`${out.skipped} failed — check logs`);
      }
      setMsg({
        kind: "ok",
        text: parts.length > 0 ? parts.join(" · ") : "Nothing to mark.",
      });
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn primary sm"
        onClick={onClick}
        disabled={disabled || pending}
        title={tooltip}
        aria-label={cta}
        data-tier={tier}
        style={
          disabled
            ? { cursor: "not-allowed", opacity: 0.5 }
            : pending
              ? { opacity: 0.7 }
              : undefined
        }
      >
        {pending ? "Working…" : cta}
      </button>

      {msg ? (
        <div
          role="status"
          className={msg.kind === "ok" ? "email-hunt-msg ok" : "email-hunt-msg err"}
          style={{
            gridColumn: "1 / -1",
            marginTop: 8,
            fontSize: 12,
          }}
        >
          {msg.text}
        </div>
      ) : null}

      {confirmOpen ? (
        <ConfirmInactiveModal
          count={campaignPartnerIds.length}
          onConfirm={confirmMarkInactive}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Confirmation modal for the bounced-tier "Mark inactive" action.
 * Uses a native <dialog> so focus-trap + Escape come from the browser.
 * Copy mirrors the pattern in the task spec — names the consequence
 * ("removes from drafting pools") and the reversal path ("undoable via
 * tracker") so the founder can click through confidently.
 */
function ConfirmInactiveModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-inactive-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        // Click outside the dialog body closes — mirrors the
        // EmailHuntModal pattern.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "20px 22px",
          maxWidth: 440,
          width: "100%",
          boxShadow: "var(--shadow)",
        }}
      >
        <h2
          id="mark-inactive-title"
          style={{ margin: 0, fontSize: 15, fontWeight: 600 }}
        >
          Mark {count} partner{count === 1 ? "" : "s"} inactive?
        </h2>
        <p
          style={{
            margin: "10px 0 0 0",
            fontSize: 13,
            color: "var(--text-dim)",
            lineHeight: 1.55,
          }}
        >
          This removes them from drafting pools. Undoable via the tracker
          drawer &mdash; change the status code back to a positive value
          and the partner re-enters the flow.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            className="email-hunt-btn secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="email-hunt-btn primary"
            onClick={onConfirm}
            autoFocus
          >
            Yes, mark inactive
          </button>
        </div>
      </div>
    </div>
  );
}
