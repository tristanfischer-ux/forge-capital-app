"use client";

import { useState, useTransition } from "react";
import { draftSectionWithHaiku, saveSectionToTemplate } from "./actions";
import type { SectionKind } from "./types";

/**
 * Inline "Draft with Haiku →" affordance for one section of the V4
 * templates panel. Sits next to the section label, opens a small inline
 * editor with the returned draft, and lets the user regenerate or save.
 *
 * Wire-up (UI-E, 2026-04-22):
 *   - Button triggers `draftSectionWithHaiku({ sectionKind, campaignId })`
 *   - Draft is shown in a textarea the user can edit
 *   - "Regenerate" re-calls the action (the seed prompt doesn't change;
 *     Haiku's sampling variance is the regeneration source)
 *   - "Save to template" writes the textarea value to email_templates
 *     via `saveSectionToTemplate()`, then the page revalidates.
 *
 * When `hasAnthropicKey` is false, the button is hidden entirely. The
 * action still checks defensively on the server — see actions.ts.
 */
export function AiSectionDrafter({
  sectionKind,
  campaignId,
  existingBody,
  hasAnthropicKey,
  side,
}: {
  sectionKind: SectionKind;
  campaignId: string;
  existingBody: string | null;
  hasAnthropicKey: boolean;
  side: "asking" | "offering";
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  if (!hasAnthropicKey) {
    // Render nothing — the action would error anyway. Keeps the label
    // row tidy. The page header already shows the "missing key" state
    // if we ever want to surface it.
    return null;
  }

  function runDraft() {
    setError(null);
    setSavedNote(null);
    setIsOpen(true);
    startTransition(async () => {
      const result = await draftSectionWithHaiku({
        sectionKind,
        campaignId,
      });
      if (result.ok) {
        setDraft(result.draft);
      } else {
        setError(result.error);
      }
    });
  }

  function runSave() {
    if (!draft || draft.trim() === "") return;
    setError(null);
    setSavedNote(null);
    startTransition(async () => {
      const result = await saveSectionToTemplate({
        sectionKind,
        campaignId,
        body: draft,
      });
      if (result.ok) {
        setSavedNote("Saved to template.");
      } else {
        setError(result.error);
      }
    });
  }

  // Amber for supplier side, indigo accent for asking side — matches the
  // V4 `.tb-var` colour family used in the synthesis highlights.
  const accentColor = side === "offering" ? "var(--amber)" : "var(--accent)";
  const accentSoft =
    side === "offering" ? "var(--amber-light)" : "var(--accent-softer)";

  const buttonLabel = draft || isOpen ? "Redraft with Haiku" : "Draft with Haiku →";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginLeft: "auto",
      }}
    >
      <button
        type="button"
        className="btn sm"
        onClick={runDraft}
        disabled={isPending}
        title={
          existingBody
            ? "Generate a fresh draft for this section using Claude Haiku."
            : "Generate a first draft for this section using Claude Haiku."
        }
        style={{
          fontSize: 10,
          padding: "3px 8px",
          borderColor: accentColor,
          color: accentColor,
          background: accentSoft,
          fontWeight: 600,
          textTransform: "none",
          letterSpacing: 0,
        }}
      >
        {isPending && !draft ? "Drafting…" : buttonLabel}
      </button>

      {isOpen ? (
        <DrafterPanel
          draft={draft}
          error={error}
          savedNote={savedNote}
          isPending={isPending}
          sectionKind={sectionKind}
          onChange={setDraft}
          onRegenerate={runDraft}
          onSave={runSave}
          onClose={() => {
            setIsOpen(false);
            setDraft(null);
            setError(null);
            setSavedNote(null);
          }}
        />
      ) : null}
    </span>
  );
}

function DrafterPanel({
  draft,
  error,
  savedNote,
  isPending,
  sectionKind,
  onChange,
  onRegenerate,
  onSave,
  onClose,
}: {
  draft: string | null;
  error: string | null;
  savedNote: string | null;
  isPending: boolean;
  sectionKind: SectionKind;
  onChange: (v: string) => void;
  onRegenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Draft with Haiku"
      style={{
        position: "absolute",
        right: 16,
        left: 16,
        zIndex: 20,
        marginTop: 6,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
        boxShadow: "var(--shadow)",
        // Anchor the panel to the tb-para row so it overlays the next
        // section's body rather than pushing layout around. The parent
        // span has `position: relative` implicitly via the flex context
        // of .tb-para — we set it on the wrapper.
      }}
      onClick={(e) => {
        // Prevent clicks inside the panel bubbling up (e.g. to tb-para
        // onClick handlers in the future).
        e.stopPropagation();
      }}
    >
      {error ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--danger, #b91c1c)",
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 4,
            background: "var(--danger-light, #fef2f2)",
            border: "1px solid var(--danger-border, #fecaca)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      ) : null}

      {savedNote ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--success, #166534)",
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 4,
            background: "var(--success-light, #f0fdf4)",
            border: "1px solid var(--success-border, #bbf7d0)",
          }}
        >
          {savedNote}
        </div>
      ) : null}

      <textarea
        value={draft ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={sectionKind === "cta" ? 2 : 6}
        placeholder={
          isPending && !draft
            ? "Drafting with Haiku…"
            : sectionKind === "cta"
              ? "20min_call  or  presentation_first"
              : "Draft will appear here. Edit before saving."
        }
        style={{
          width: "100%",
          fontSize: 12,
          lineHeight: 1.55,
          padding: 8,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--surface-alt)",
          color: "var(--text)",
          fontFamily: "inherit",
          resize: "vertical",
          minHeight: sectionKind === "cta" ? 38 : 96,
        }}
      />

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn sm"
          onClick={onRegenerate}
          disabled={isPending}
          style={{ fontSize: 11 }}
        >
          {isPending ? "Working…" : "Regenerate"}
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={onSave}
          disabled={isPending || !draft || draft.trim() === ""}
          style={{ fontSize: 11 }}
        >
          Save to template
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn sm"
          onClick={onClose}
          disabled={isPending}
          style={{ fontSize: 11 }}
        >
          Close
        </button>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "var(--text-faint)",
          letterSpacing: 0,
          textTransform: "none",
          fontWeight: 400,
        }}
      >
        Model: claude-haiku-4-5. Edit freely before saving. Save overwrites the
        {sectionKind === "cta" ? " cta_variant" : ` ${sectionKind}`} column on
        the campaign&rsquo;s email_templates row.
      </div>
    </div>
  );
}
