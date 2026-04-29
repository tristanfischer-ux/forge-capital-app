import type { EmailTier } from "@/lib/queries/tracker";

/**
 * 5-tier email deliverability badge. Source: `003_partners_mirror.sql`
 * + V4-FEEDBACK-ROUND-2.md §"Verification tiers".
 *
 * Only `corresponded` and `hunter_verified` can advance a partner to +2
 * Drafted. `generic_blocked` and `bounced` render RED with a
 * replacement-hunt CTA — feedback round 2 was explicit about this.
 *
 * Colour tokens are the `tier-*` families wired in `tailwind.config.ts`.
 */

interface TierMeta {
  label: string;
  /** Tailwind classes that compose bg/text/border for the badge. */
  classes: string;
  /** If true, the row should offer a "find a replacement" action. */
  showReplacementCta: boolean;
  /** Short tooltip shown on hover — clarifies why the tier matters. */
  tooltip: string;
}

const TIER_META: Record<Exclude<EmailTier, null>, TierMeta> = {
  corresponded: {
    label: "Corresponded",
    classes:
      "bg-tier-corresponded-bg text-tier-corresponded-fg border-tier-corresponded-border",
    showReplacementCta: false,
    tooltip: "We have exchanged mail with this address in Gmail.",
  },
  hunter_verified: {
    label: "Hunter-verified",
    classes:
      "bg-tier-hunter-bg text-tier-hunter-fg border-tier-hunter-border",
    showReplacementCta: false,
    tooltip: "Hunter confidence 80+ and not a generic address.",
  },
  // NeverBounce sendable bucket — green, mirrors the corresponded family
  // because the verdict comes straight from the receiving server.
  neverbounce_valid: {
    label: "NeverBounce — valid",
    classes:
      "bg-tier-corresponded-bg text-tier-corresponded-fg border-tier-corresponded-border",
    showReplacementCta: false,
    tooltip: "NeverBounce confirmed deliverable. Safe to send.",
  },
  // Catch-all is sendable but the domain accepts everything, so we tint
  // it the same green as valid (still passes the gate) — the lower
  // confidence is communicated via the label, not a colour change.
  neverbounce_catchall: {
    label: "NeverBounce — catch-all",
    classes:
      "bg-tier-corresponded-bg text-tier-corresponded-fg border-tier-corresponded-border",
    showReplacementCta: false,
    tooltip:
      "Domain accepts everything — sendable but bounce risk is non-zero.",
  },
  // Uncertain bucket — amber, same family as `unverified`. No CTA chip
  // because the resolution path is identical to unverified (Hunter or
  // LinkedIn cross-check).
  neverbounce_unknown: {
    label: "NeverBounce — unknown",
    classes:
      "bg-tier-unverified-bg text-tier-unverified-fg border-tier-unverified-border",
    showReplacementCta: false,
    tooltip:
      "NeverBounce returned no verdict. Cannot advance to +2 Drafted.",
  },
  unverified: {
    label: "Unverified",
    classes:
      "bg-tier-unverified-bg text-tier-unverified-fg border-tier-unverified-border",
    showReplacementCta: false,
    tooltip: "Never checked or inconclusive. Cannot advance to +2 Drafted.",
  },
  generic_blocked: {
    label: "Generic — blocked",
    classes:
      "bg-tier-generic-bg text-tier-generic-fg border-tier-generic-border",
    showReplacementCta: true,
    tooltip: "Generic pattern (info@ / contact@ / team@). Hard-blocked.",
  },
  // Hard-blocked NeverBounce variants — red family, replacement CTA.
  neverbounce_invalid: {
    label: "NeverBounce — invalid",
    classes:
      "bg-tier-bounced-bg text-tier-bounced-fg border-tier-bounced-border",
    showReplacementCta: true,
    tooltip: "NeverBounce confirmed undeliverable. Hard-blocked.",
  },
  neverbounce_disposable: {
    label: "NeverBounce — disposable",
    classes:
      "bg-tier-bounced-bg text-tier-bounced-fg border-tier-bounced-border",
    showReplacementCta: true,
    tooltip: "Disposable / throwaway mailbox. Hard-blocked.",
  },
  bounced: {
    label: "Bounced",
    classes:
      "bg-tier-bounced-bg text-tier-bounced-fg border-tier-bounced-border",
    showReplacementCta: true,
    tooltip: "Address has hard-bounced. Hard-blocked.",
  },
};

export function TierBadge({ tier }: { tier: EmailTier }) {
  if (!tier) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-border-soft bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-text-faint"
        title="No deliverability tier on file"
      >
        —
      </span>
    );
  }

  const meta = TIER_META[tier];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.classes}`}
        title={meta.tooltip}
      >
        {meta.label}
      </span>
      {meta.showReplacementCta ? (
        <span
          className="text-[10px] font-medium text-red underline decoration-dotted underline-offset-2"
          title="Phase 5 will wire this to the replacement-hunt workflow."
        >
          Hunt replacement →
        </span>
      ) : null}
    </span>
  );
}
