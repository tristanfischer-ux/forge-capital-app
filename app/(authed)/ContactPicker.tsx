"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ContactDirectory, ContactOption } from "@/lib/queries/contacts";
import { switchContact } from "./approval/switchContactAction";
import { loadContactDirectory } from "./approval/loadContactDirectoryAction";
import { addParallelContact } from "./approval/addParallelContactAction";

/**
 * Inline contact-picker chip — renders the currently-linked contact
 * (name · title) plus a ▾ affordance. Clicking opens a popover
 * listing every known contact at the same firm, each with name,
 * title, a ~120-char bio preview, email + verification state, and
 * a LinkedIn link. A "Reach out to this person" button on a non-
 * current row swaps `campaign_partners.partner_id` + clears the
 * cached draft so the composer regenerates for the new person
 * (Tristan 2026-04-24 preference: "regenerate from scratch").
 *
 * Data loading is lazy — the parent can pre-pass the directory when
 * it already has it (e.g. /approval render), or we fetch on open via
 * the `load` prop. The lazy load keeps the outgoing-sheet paint fast
 * even when a firm has 150+ contacts (max in DB as of 2026-04-24).
 *
 * Works identically for investor-kind and customer-kind partners —
 * the `kind` field on the directory drives the header noun.
 */
export interface ContactPickerProps {
  campaignPartnerId: string;
  /** Optional pre-loaded directory — skips the fetch on open. Only
   *  worth passing when the parent already has the data in hand
   *  (e.g. the tracker drawer which is itself expanded lazily). */
  initialDirectory?: ContactDirectory | null;
  /** The current contact's name+title, rendered in the chip. */
  currentLabel: string;
}

export function ContactPicker({
  campaignPartnerId,
  initialDirectory,
  currentLabel,
}: ContactPickerProps) {
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState<ContactDirectory | null>(
    initialDirectory ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticCurrent, setOptimisticCurrent] = useState<number | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape to close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Lazy fetch when the popover opens if we don't have pre-loaded data.
  useEffect(() => {
    if (!open || directory) return;
    setLoading(true);
    setError(null);
    loadContactDirectory(campaignPartnerId)
      .then((d) => {
        setDirectory(d);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open, directory, campaignPartnerId]);

  function onSwitch(newPartnerId: number) {
    setError(null);
    setOptimisticCurrent(newPartnerId);
    startTransition(async () => {
      const result = await switchContact({ campaignPartnerId, newPartnerId });
      if (!result.ok) {
        setOptimisticCurrent(null);
        setError(result.error);
        return;
      }
      // Update the directory in-place so the list re-renders with
      // the new current highlighted. The full row data + revalidation
      // will freshen on the next server round-trip.
      if (directory) {
        setDirectory({
          ...directory,
          current_partner_id: newPartnerId,
          contacts: directory.contacts.map((c) => ({
            ...c,
            is_current: c.partner_id === newPartnerId,
          })),
        });
      }
      setOptimisticCurrent(null);
    });
  }

  // Tier 3 — parallel outreach. Creates a second campaign_partners
  // row for the same firm so the founder can reach out to TWO people
  // at IKEA in parallel threads. Status +0 Pending approval, DB gate
  // blocks dispatch until promoted.
  const [addNotice, setAddNotice] = useState<string | null>(null);
  function onAddParallel(newPartnerId: number) {
    setError(null);
    setAddNotice(null);
    setOptimisticCurrent(newPartnerId);
    startTransition(async () => {
      const result = await addParallelContact({
        sourceCampaignPartnerId: campaignPartnerId,
        newPartnerId,
      });
      setOptimisticCurrent(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Warn (non-blocking) if we just added the 3rd+ active thread
      // at the same firm — outreach hygiene flag.
      const n = result.existing_active_threads;
      if (n >= 2) {
        setAddNotice(
          `Added as parallel thread. You now have ${n + 1} active threads at this firm — double-check the angle isn't duplicating.`,
        );
      } else {
        setAddNotice(
          "Added as parallel thread — the new row is on /approval at +0 Pending approval.",
        );
      }
      // Keep the popover open so the founder can see the success
      // notice; close via ✕ or outside-click.
    });
  }

  const nounHeader =
    directory?.kind === "customer"
      ? `Contacts at ${directory?.firm_name ?? "this customer"}`
      : `Contacts at ${directory?.firm_name ?? "this firm"}`;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Switch contact"
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px 2px 8px",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--accent)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          cursor: "pointer",
          lineHeight: 1.3,
        }}
      >
        <span>{currentLabel}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={nounHeader}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: 380,
            maxHeight: 480,
            overflowY: "auto",
            padding: 10,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginBottom: 8,
            }}
          >
            {nounHeader}
            {directory ? (
              <span
                style={{
                  color: "var(--text-faint)",
                  fontWeight: 400,
                  textTransform: "none",
                  letterSpacing: 0,
                  marginLeft: 6,
                }}
              >
                ({directory.contacts.length}{" "}
                {directory.contacts.length === 1 ? "contact" : "contacts"})
              </span>
            ) : null}
          </div>

          {addNotice ? (
            <div
              style={{
                marginBottom: 8,
                padding: "6px 8px",
                fontSize: 11,
                color: "var(--accent)",
                background: "var(--accent-softer, var(--surface-alt))",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                lineHeight: 1.4,
              }}
            >
              ✓ {addNotice}
            </div>
          ) : null}

          {loading ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)", padding: 12 }}>
              Loading contacts…
            </div>
          ) : error ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--accent-danger, #b91c1c)",
                padding: 12,
              }}
            >
              {error}
            </div>
          ) : !directory || directory.contacts.length === 0 ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                padding: 12,
                lineHeight: 1.5,
              }}
            >
              No known contacts at this firm yet. Use the <b>Resolve email</b>{" "}
              flow on this row to find named contacts via Hunter.
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {directory.contacts.map((c) => (
                <ContactRow
                  key={c.partner_id}
                  contact={{
                    ...c,
                    is_current:
                      optimisticCurrent === c.partner_id
                        ? true
                        : c.is_current,
                  }}
                  isPending={isPending && optimisticCurrent === c.partner_id}
                  onSwitch={() => onSwitch(c.partner_id)}
                  onAddParallel={() => onAddParallel(c.partner_id)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContactRow({
  contact,
  isPending,
  onSwitch,
  onAddParallel,
}: {
  contact: ContactOption;
  isPending: boolean;
  onSwitch: () => void;
  onAddParallel: () => void;
}) {
  const bioPreview =
    contact.bio && contact.bio.length > 140
      ? contact.bio.slice(0, 140).trim() + "…"
      : contact.bio;

  const tierBadge = emailTierBadge(contact);

  return (
    <li
      style={{
        padding: "8px 10px",
        border: contact.is_current
          ? "1px solid var(--accent)"
          : "1px solid var(--border-soft, var(--border))",
        background: contact.is_current
          ? "var(--accent-softer, var(--surface))"
          : "var(--surface)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          {contact.name ?? "— unnamed contact —"}
        </div>
        {contact.is_primary_contact ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--accent)",
              background: "var(--accent-softer, transparent)",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            Primary
          </span>
        ) : null}
      </div>
      {contact.title ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {contact.title}
        </div>
      ) : null}
      {bioPreview ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.4,
            marginTop: 2,
          }}
        >
          {bioPreview}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 10,
          color: "var(--text-faint)",
          marginTop: 2,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {contact.email ? (
          <span>
            {contact.email} {tierBadge ? <span>{tierBadge}</span> : null}
          </span>
        ) : (
          <span style={{ fontStyle: "italic" }}>no email on file</span>
        )}
        {contact.linkedin ? (
          <a
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            LinkedIn →
          </a>
        ) : null}
      </div>
      {contact.is_current ? (
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--accent)",
            marginTop: 4,
          }}
        >
          ✓ Currently reaching out to this person
        </div>
      ) : (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onSwitch}
            disabled={isPending}
            title="Replace the current contact on this row. The cached draft is discarded and the composer regenerates from scratch for the new person."
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--accent)",
              background: "var(--surface)",
              border: "1px solid var(--accent)",
              borderRadius: 999,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Working…" : "Switch to this person →"}
          </button>
          <button
            type="button"
            onClick={onAddParallel}
            disabled={isPending}
            title="Keep the current contact AND add this person as a second parallel thread at the same firm. Creates a new row at +0 Pending approval."
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-dim)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            + Add as parallel thread
          </button>
        </div>
      )}
    </li>
  );
}

function emailTierBadge(contact: ContactOption): string | null {
  if (contact.email_verified) return "· verified";
  const tier = (contact.email_tier ?? "").toLowerCase();
  if (tier === "verified") return "· verified";
  if (tier === "guessed") return "· guessed";
  if (contact.email) return "· unverified";
  return null;
}
