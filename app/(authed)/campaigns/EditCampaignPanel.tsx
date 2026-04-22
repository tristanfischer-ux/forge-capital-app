"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CampaignSummary } from "@/lib/queries/campaigns";
import { updateCampaignMetadata } from "./actions";

/**
 * Modal panel for editing a single campaign's counterpart + week clock.
 * Opened from the campaign-switcher pencil button. Saves via the server
 * action in ./actions.ts, which is RLS-gated to founders only.
 *
 * Design:
 *  - Floats over the page (fixed, scrim backdrop).
 *  - Fields: counterpart_name, counterpart_email, counterpart_role,
 *    week_started_at (date input), week_count_target (int).
 *  - One "Save" button. Escape / scrim click to close.
 *  - Shows the current values pre-filled. "Save" → router.refresh()
 *    so every section that reads campaign metadata picks up the
 *    changes immediately.
 *
 * Uses V4's token palette via CSS variables (--surface, --border, etc.)
 * for visual continuity with the rest of the app. Not a mockup-faithful
 * port of a V4 section — V4 didn't have this panel, it's a 2026-04-22
 * addition from the "campaign editing is in-app" decision.
 */
export function EditCampaignPanel({
  campaign,
  onClose,
}: {
  campaign: CampaignSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const [counterpartName, setCounterpartName] = useState(
    campaign.counterpart_name ?? "",
  );
  const [counterpartEmail, setCounterpartEmail] = useState(
    campaign.counterpart_email ?? "",
  );
  const [counterpartRole, setCounterpartRole] = useState(
    campaign.counterpart_role ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const out = await updateCampaignMetadata({
        campaignId: campaign.id,
        counterpartName,
        counterpartEmail,
        counterpartRole,
        // Week fields removed from the UI 2026-04-22 (Tristan flagged
        // "not necessary"). Server action still accepts them to avoid
        // a breaking signature change; pass null so nothing overwrites
        // existing values.
        weekStartedAt: null,
        weekCountTarget: null,
      });
      if (out.ok) {
        router.refresh();
        onClose();
      } else {
        setError(out.error);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${campaign.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.38)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        style={{
          width: "min(92vw, 520px)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--shadow-lg, 0 10px 40px rgba(15,23,42,0.15))",
          padding: "22px 24px",
        }}
      >
        <header style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              color: "var(--text)",
            }}
          >
            Edit campaign &middot; {campaign.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 3,
            }}
          >
            Counterpart details feed the approval sheet, weekly update
            &ldquo;To:&rdquo;, tracker subtitle, and week counter.
          </div>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field
            label="Counterpart name"
            hint="Who approves shortlists on this campaign."
            value={counterpartName}
            onChange={setCounterpartName}
            placeholder="e.g. Andrew Murphy"
          />
          <Field
            label="Counterpart email"
            hint="Used when we create a Gmail draft for the weekly update."
            value={counterpartEmail}
            onChange={setCounterpartEmail}
            placeholder="name@firm.com"
            type="email"
          />
          <Field
            label="Counterpart role"
            hint="Short descriptor shown on the approval artefact."
            value={counterpartRole}
            onChange={setCounterpartRole}
            placeholder="e.g. investor approver"
          />
        </div>

        {error ? (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--red-light, #fef2f2)",
              color: "var(--red, #dc2626)",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        ) : null}

        <footer
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-alt)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid var(--accent-dark, #4338ca)",
              borderRadius: 8,
              background: "var(--accent)",
              color: "white",
              cursor: isPending ? "progress" : "pointer",
            }}
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
          color: "var(--text-dim)",
        }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "8px 10px",
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--surface)",
          color: "var(--text)",
          outline: "none",
        }}
      />
      {hint ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            lineHeight: 1.4,
          }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}
