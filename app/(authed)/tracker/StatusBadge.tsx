/**
 * 16-code status badge. Taxonomy source: `004_campaign_partners.sql`
 * + Outreach-Writing-Rules-TF.md Rule 8. Colours follow the V4 mockup's
 * `tag-chip` family (tag-approved / tag-status / tag-blocked / tag-warn).
 *
 * Colour rule:
 *   -3, -2, -1  → red  (tag-blocked)
 *   +0, +1      → amber (tag-warn) — waiting on approval / draft
 *   +2…+9       → indigo (tag-status) — in flight
 *   +10, +11, +12 → green (tag-approved) — late-stage
 *
 * Unknown codes render a neutral chip. The V4 mockup labels codes with
 * both the numeric prefix and a short label (e.g. "+3 Email sent"); we
 * do the same by prefixing code to either the DB label or our fallback.
 */

type StatusFamily = "late" | "inflight" | "waiting" | "declined" | "unknown";

interface StatusMeta {
  family: StatusFamily;
  fallbackLabel: string;
}

const STATUS_TABLE: Record<string, StatusMeta> = {
  "+12": { family: "late", fallbackLabel: "Committed" },
  "+11": { family: "late", fallbackLabel: "Term sheet" },
  "+10": { family: "late", fallbackLabel: "NDA/diligence" },
  "+9": { family: "inflight", fallbackLabel: "Meeting held" },
  "+8": { family: "inflight", fallbackLabel: "Meeting scheduled" },
  "+7": { family: "inflight", fallbackLabel: "Meeting offered" },
  "+6": { family: "inflight", fallbackLabel: "Response received" },
  "+5": { family: "inflight", fallbackLabel: "Follow-up sent" },
  "+4": { family: "inflight", fallbackLabel: "Auto-reply / OOO" },
  "+3": { family: "inflight", fallbackLabel: "Email sent" },
  "+2": { family: "inflight", fallbackLabel: "Drafted — ready to send" },
  "+1": { family: "waiting", fallbackLabel: "Approved — awaiting draft" },
  "+0": { family: "waiting", fallbackLabel: "Pending approval" },
  "-1": { family: "declined", fallbackLabel: "Declined" },
  "-2": { family: "declined", fallbackLabel: "Bounced" },
  "-3": { family: "declined", fallbackLabel: "Disqualified" },
};

const FAMILY_CLASSES: Record<StatusFamily, string> = {
  late:
    "bg-chip-approved-bg text-chip-approved-fg border-chip-approved-border",
  inflight: "bg-chip-status-bg text-chip-status-fg border-chip-status-border",
  waiting: "bg-chip-warn-bg text-chip-warn-fg border-chip-warn-border",
  declined:
    "bg-chip-blocked-bg text-chip-blocked-fg border-chip-blocked-border",
  unknown: "bg-surface-alt text-text-dim border-border-soft",
};

export function StatusBadge({
  statusCode,
  statusLabel,
}: {
  statusCode: string | null;
  statusLabel: string | null;
}) {
  if (!statusCode) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-alt px-2.5 py-1 text-[11px] font-medium text-text-faint"
        title="No status set"
      >
        —
      </span>
    );
  }

  const meta = STATUS_TABLE[statusCode] ?? {
    family: "unknown" as const,
    fallbackLabel: "Unknown code",
  };
  const label = statusLabel?.trim() || meta.fallbackLabel;
  const classes = FAMILY_CLASSES[meta.family];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes}`}
    >
      <span className="font-semibold tabular-nums">{statusCode}</span>
      <span>{label}</span>
    </span>
  );
}
