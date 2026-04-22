"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getEmailHuntResolution,
  saveEmailOverride,
  queueHunterLookup,
  type EmailHuntPartner,
  type EmailHuntResolution,
} from "./email-hunt-actions";

/**
 * Email-hunt modal (#69). Opens in response to the global
 * `fc:resolve-email` custom event (dispatched by the "Resolve email →"
 * chip on each match result card and the drill-down CTA).
 *
 * Two resolution paths per partner:
 *   1. Manual override — user pastes a known-good email. Stores in
 *      `partner_email_overrides` and unblocks advancement immediately.
 *   2. Hunter queue — user asks the nightly Forge Capital pipeline to
 *      prioritise this partner. Stores in `partner_email_hunt_requests`.
 *
 * The modal uses a native <dialog> element so focus-management + Escape
 * behaviour come from the browser primitive — no focus-trap library.
 */
export function EmailHuntModal() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();
  const [investorId, setInvestorId] = useState<number | null>(null);
  const [resolution, setResolution] = useState<EmailHuntResolution | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Listen globally for the open event.
  useEffect(() => {
    function onOpen(e: Event) {
      const ce = e as CustomEvent<{ investorId: number }>;
      if (!ce.detail || typeof ce.detail.investorId !== "number") return;
      setInvestorId(ce.detail.investorId);
    }
    window.addEventListener("fc:resolve-email", onOpen);
    return () => window.removeEventListener("fc:resolve-email", onOpen);
  }, []);

  // Open the dialog + fetch data when investorId changes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (investorId === null) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    setLoading(true);
    setLoadError(null);
    setResolution(null);
    getEmailHuntResolution({ investorId })
      .then((out) => {
        if (out.ok) setResolution(out.data);
        else setLoadError(out.error);
      })
      .catch((err) => {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load partners",
        );
      })
      .finally(() => setLoading(false));
  }, [investorId]);

  const close = () => {
    setInvestorId(null);
  };

  function onPartnerResolved() {
    // Re-fetch so the modal reflects the new state (override recorded
    // or queue entry added), then nudge the results list.
    if (investorId !== null) {
      setLoading(true);
      getEmailHuntResolution({ investorId })
        .then((out) => {
          if (out.ok) setResolution(out.data);
        })
        .finally(() => setLoading(false));
    }
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      className="email-hunt-dialog"
      onClick={(e) => {
        // Click on the ::backdrop (outside the dialog content) closes.
        if (e.target === dialogRef.current) close();
      }}
      onClose={close}
    >
      <div className="email-hunt-head">
        <div>
          <div className="email-hunt-title">
            Resolve email
            {resolution?.firm_name ? ` — ${resolution.firm_name}` : ""}
          </div>
          <div className="email-hunt-sub">
            Unblock partners that currently can&rsquo;t advance past{" "}
            <code>+1 Ready to draft</code> because no verified email is on
            file. Either paste one you already know, or queue the partner
            for the nightly Hunter lookup.
          </div>
        </div>
        <button
          type="button"
          className="email-hunt-close"
          onClick={close}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="email-hunt-body">
        {loading && !resolution ? (
          <div
            className="email-hunt-msg info"
            style={{ textAlign: "center" }}
          >
            Loading partners…
          </div>
        ) : loadError ? (
          <div className="email-hunt-msg err">{loadError}</div>
        ) : resolution && resolution.partners.length === 0 ? (
          <div className="email-hunt-msg info">
            No partners on file for this firm yet — the nightly partner
            discovery step fills this once it resolves team pages or
            LinkedIn.
          </div>
        ) : resolution ? (
          <>
            {resolution.partners.map((partner) => (
              <PartnerResolver
                key={partner.partner_id}
                partner={partner}
                onResolved={onPartnerResolved}
              />
            ))}
          </>
        ) : null}
      </div>

      <div className="email-hunt-foot">
        <button
          type="button"
          className="email-hunt-btn secondary"
          onClick={close}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}

function PartnerResolver({
  partner,
  onResolved,
}: {
  partner: EmailHuntPartner;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<"manual" | "hunter" | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [tier, setTier] = useState<"hunter_verified" | "corresponded">(
    "hunter_verified",
  );
  const [msg, setMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const overrideEmail = partner.override_email;
  const effectiveTier = partner.override_tier ?? partner.current_tier;
  const canAdvance =
    effectiveTier === "corresponded" || effectiveTier === "hunter_verified";
  const queueStatus = partner.hunt_request_status;

  function submitManual() {
    setMsg(null);
    startTransition(async () => {
      const out = await saveEmailOverride({
        partnerId: partner.partner_id,
        email,
        tier,
        sourceNote: note || null,
      });
      if (out.ok) {
        setMsg({
          kind: "ok",
          text: `Saved. ${partner.name ?? "Partner"} can now advance past +1.`,
        });
        setEmail("");
        setNote("");
        setMode(null);
        onResolved();
      } else {
        setMsg({ kind: "err", text: out.error });
      }
    });
  }

  function submitHunter() {
    setMsg(null);
    startTransition(async () => {
      const out = await queueHunterLookup({
        partnerId: partner.partner_id,
        notes: note || null,
      });
      if (out.ok) {
        setMsg({
          kind: "ok",
          text: `Queued — the nightly Hunter pass will prioritise ${partner.name ?? "this partner"}.`,
        });
        setNote("");
        setMode(null);
        onResolved();
      } else {
        setMsg({ kind: "err", text: out.error });
      }
    });
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {partner.name ?? "Unnamed partner"}
          </div>
          {partner.title ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                marginTop: 2,
              }}
            >
              {partner.title}
            </div>
          ) : null}
        </div>
        <TierChip tier={effectiveTier} canAdvance={canAdvance} />
      </div>

      {overrideEmail ? (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            background: "var(--green-light)",
            borderRadius: 6,
            color: "var(--green)",
          }}
        >
          Your override on file: <code>{overrideEmail}</code>
        </div>
      ) : partner.current_email ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          Mirror has: <code>{partner.current_email}</code>
          {!canAdvance ? " (not verified)" : ""}
        </div>
      ) : null}

      {queueStatus ? (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            background: "var(--accent-light)",
            borderRadius: 6,
            color: "var(--accent)",
          }}
        >
          Queued for Hunter — status: <code>{queueStatus}</code>
        </div>
      ) : null}

      {msg ? (
        <div className={`email-hunt-msg ${msg.kind}`}>{msg.text}</div>
      ) : null}

      {!canAdvance ? (
        <>
          {mode === null ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="email-hunt-btn primary"
                onClick={() => setMode("manual")}
                disabled={isPending}
              >
                I have the email
              </button>
              <button
                type="button"
                className="email-hunt-btn secondary"
                onClick={() => setMode("hunter")}
                disabled={isPending || queueStatus === "pending"}
                title={
                  queueStatus === "pending"
                    ? "Already queued — pipeline will pick it up tonight"
                    : undefined
                }
              >
                {queueStatus === "pending"
                  ? "Already queued"
                  : "Queue for Hunter"}
              </button>
            </div>
          ) : mode === "manual" ? (
            <form
              className="email-hunt-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitManual();
              }}
            >
              <label className="email-hunt-label">
                Email
                <input
                  className="email-hunt-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="partner@fund.com"
                  autoFocus
                />
              </label>
              <label className="email-hunt-label">
                How did you verify this?
                <select
                  className="email-hunt-select"
                  value={tier}
                  onChange={(e) =>
                    setTier(e.target.value as typeof tier)
                  }
                >
                  <option value="hunter_verified">
                    I&rsquo;m confident (referral / LinkedIn / website)
                  </option>
                  <option value="corresponded">
                    We&rsquo;ve already exchanged email
                  </option>
                </select>
              </label>
              <label className="email-hunt-label">
                Source note (optional)
                <input
                  className="email-hunt-input"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. passed along by Alex at Felicis"
                />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="email-hunt-btn secondary"
                  onClick={() => {
                    setMode(null);
                    setMsg(null);
                  }}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="email-hunt-btn primary"
                  disabled={isPending || !email}
                >
                  {isPending ? "Saving…" : "Save override"}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="email-hunt-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitHunter();
              }}
            >
              <div
                className="email-hunt-msg info"
                style={{ marginBottom: 0 }}
              >
                The nightly Forge Capital pipeline will prioritise this
                partner for Hunter email-finder on its next run. Results
                write back to <code>partners_mirror.email_tier</code>.
              </div>
              <label className="email-hunt-label">
                Notes for the pipeline (optional)
                <textarea
                  className="email-hunt-input"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. tried info@ but it bounced, they don't use @fund.com pattern"
                />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="email-hunt-btn secondary"
                  onClick={() => {
                    setMode(null);
                    setMsg(null);
                  }}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="email-hunt-btn primary"
                  disabled={isPending}
                >
                  {isPending ? "Queuing…" : "Queue for Hunter"}
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontStyle: "italic",
          }}
        >
          Email ready to advance — no action needed.
        </div>
      )}
    </div>
  );
}

function TierChip({
  tier,
  canAdvance,
}: {
  tier: EmailHuntPartner["current_tier"] | string | null;
  canAdvance: boolean;
}) {
  if (!tier) {
    return (
      <span className="tag-chip tag-blocked" style={{ flexShrink: 0 }}>
        <span className="dot" />
        No tier
      </span>
    );
  }
  if (canAdvance) {
    return (
      <span className="tag-chip tag-approved" style={{ flexShrink: 0 }}>
        <span className="dot" />
        {tier === "corresponded" ? "Corresponded" : "Hunter-verified"}
      </span>
    );
  }
  const label =
    tier === "unverified"
      ? "Unverified"
      : tier === "generic_blocked"
        ? "Generic blocked"
        : tier === "bounced"
          ? "Bounced"
          : tier;
  const kind =
    tier === "generic_blocked" || tier === "bounced"
      ? "tag-blocked"
      : "tag-warn";
  return (
    <span className={`tag-chip ${kind}`} style={{ flexShrink: 0 }}>
      <span className="dot" />
      {label}
    </span>
  );
}
