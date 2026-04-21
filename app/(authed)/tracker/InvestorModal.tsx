"use client";

import { useEffect, useRef, useState } from "react";
import type { InvestorModalData, InvestorModalPartner } from "@/lib/queries/investorModal";
import { TierBadge } from "./TierBadge";
import { StatusBadge } from "./StatusBadge";

/**
 * Investor detail modal — port of Phase2-Mockup-V4.html §"MODAL" (lines 564–626)
 * and §"renderModal()" (lines 2613–2717), scoped to the investor archetype only.
 *
 * Why a native <dialog>: no Radix, no focus-trap library, just the browser
 * primitive. We open with `showModal()` for the built-in backdrop + focus
 * management, close on Escape (native) and on backdrop click (custom handler
 * on the dialog element — clicks that land on the dialog itself but outside
 * the panel are on the ::backdrop pseudo-element, so we compare e.target).
 *
 * V4 feedback round 2 corrections applied:
 *   - "Days since last contact" visible in the modal header.
 *   - Team rows show per-partner days-since-contact where we have data.
 *   - No raw Hunter 0–100 score exposed; we show the tier only (via TierBadge).
 *
 * Phase 2 wires the tracker row click handler; this component receives
 * `campaignPartnerId` and opens when the parent sets `open = true`.
 */

interface InvestorModalProps {
  open: boolean;
  onClose: () => void;
  /** null while data is being fetched; undefined when no row matches. */
  data: InvestorModalData | null | undefined;
  /** True while the parent is fetching — shows a one-render skeleton. */
  loading?: boolean;
}

function formatDaysSince(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatUsdRange(
  min: number | null,
  max: number | null,
): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${n}`;
  };
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `up to ${fmt(max)}`;
  return null;
}

function formatFundSize(usd: number | null): string | null {
  if (usd == null) return null;
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${Math.round(usd / 1_000_000)}M`;
  return `$${usd}`;
}

export function InvestorModal({ open, onClose, data, loading }: InvestorModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Open/close the native dialog in response to the `open` prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // showModal() adds the inert backdrop + Escape handling we want.
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Native dialog fires `close` on Escape and on dialog.close(). We forward
  // that up so the parent can reset its `open` state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function onNativeClose() {
      onClose();
    }
    dialog.addEventListener("close", onNativeClose);
    return () => dialog.removeEventListener("close", onNativeClose);
  }, [onClose]);

  // Backdrop click — when the click lands on the dialog element itself
  // (outside the inner panel), close. Inner panel clicks stop propagation.
  function onDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      className="w-[min(900px,calc(100vw-40px))] max-w-[900px] rounded-2xl border border-border bg-surface p-0 shadow-lg backdrop:bg-[rgba(17,24,39,0.35)]"
    >
      {loading || data === null ? (
        <InvestorModalSkeleton onClose={onClose} />
      ) : data === undefined ? (
        <InvestorModalEmpty onClose={onClose} />
      ) : (
        <InvestorModalContent data={data} onClose={onClose} />
      )}
    </dialog>
  );
}

function InvestorModalSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-8">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 h-7 w-7 rounded-md text-lg text-text-dim hover:bg-surface-alt hover:text-text"
      >
        ×
      </button>
      <div className="h-5 w-60 animate-pulse rounded bg-border-soft" />
      <div className="mt-3 h-3 w-96 animate-pulse rounded bg-border-soft" />
      <div className="mt-6 space-y-3">
        <div className="h-20 w-full animate-pulse rounded-lg bg-surface-alt" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-surface-alt" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-surface-alt" />
      </div>
    </div>
  );
}

function InvestorModalEmpty({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative p-10 text-center">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 h-7 w-7 rounded-md text-lg text-text-dim hover:bg-surface-alt hover:text-text"
      >
        ×
      </button>
      <h3 className="text-base font-semibold text-text">No partner data yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-dim">
        The nightly Forge Capital sync has not populated this row yet. Once the
        local pipeline pushes an investor + partner record, this modal will
        fill out automatically.
      </p>
    </div>
  );
}

function InvestorModalContent({
  data,
  onClose,
}: {
  data: InvestorModalData;
  onClose: () => void;
}) {
  const { investor, primary_partner, all_partners, campaign_partner_id } = data;
  const cheque = formatUsdRange(investor.cheque_min_usd, investor.cheque_max_usd);
  const fundSize = formatFundSize(investor.fund_size_usd);
  const hqLine = [investor.type, investor.hq_location].filter(Boolean).join(" · ");
  const synthesisParagraph = investor.connection_brief?.trim() || null;

  return (
    <>
      {/* ========== HEAD ========== */}
      <div className="relative border-b border-border bg-gradient-to-b from-[#fbfbff] to-white px-7 pb-4 pt-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 h-7 w-7 rounded-md text-[22px] leading-none text-text-dim hover:bg-surface-alt hover:text-text"
        >
          ×
        </button>
        <h2 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          {investor.firm_name ?? "Unnamed firm"}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-text-dim">
          {hqLine ? <span>{hqLine}</span> : null}
          {investor.website ? (
            <>
              {hqLine ? <span>·</span> : null}
              <a
                href={investor.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
              >
                {investor.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            </>
          ) : null}
        </div>
        {/* Primary partner + tier + days-since row */}
        {primary_partner ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold text-text">
              {primary_partner.name ?? "Unnamed partner"}
            </span>
            {primary_partner.title ? (
              <span className="text-text-dim">· {primary_partner.title}</span>
            ) : null}
            <TierBadge tier={primary_partner.email_tier} />
            <span className="text-text-faint">·</span>
            <span className="text-text-dim">
              Last contact:{" "}
              <span className="font-medium text-text">
                {formatDaysSince(primary_partner.days_since_last_contact)}
              </span>
            </span>
          </div>
        ) : null}
        {/* Tracker status chip */}
        {primary_partner?.status_code ? (
          <div className="mt-3">
            <StatusBadge
              statusCode={primary_partner.status_code}
              statusLabel={primary_partner.status_label}
            />
          </div>
        ) : null}
      </div>

      {/* ========== BODY ========== */}
      <div className="px-7 pb-2 pt-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
          {/* Main column */}
          <div className="min-w-0">
            {/* Thesis block */}
            <ModalSection heading="Thesis">
              {investor.thesis_summary ? (
                <p className="text-[13px] leading-relaxed text-text">
                  {investor.thesis_summary}
                </p>
              ) : (
                <EmptyLine>No thesis summary captured yet.</EmptyLine>
              )}
              {/* Stage / sector / geo pill row */}
              <PillRow
                entries={[
                  { label: "Stage", value: investor.stage_focus },
                  { label: "Sector", value: investor.sector_focus },
                  { label: "Geo", value: investor.geo_focus },
                ]}
              />
            </ModalSection>

            {/* Fund + cheque */}
            <ModalSection heading="Fund & cheque">
              {cheque || fundSize ? (
                <div className="flex flex-wrap gap-2">
                  {cheque ? (
                    <div className="rounded-[10px] border border-border bg-surface-alt px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
                        Cheque range
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-text">
                        {cheque}
                      </div>
                    </div>
                  ) : null}
                  {fundSize ? (
                    <div className="rounded-[10px] border border-border bg-surface-alt px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
                        Fund size
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-text">
                        {fundSize}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyLine>
                  Cheque range and fund size will arrive on the next sync.
                </EmptyLine>
              )}
            </ModalSection>

            {/* Portfolio preview */}
            <ModalSection heading="Portfolio preview">
              {investor.portfolio_companies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {investor.portfolio_companies.slice(0, 6).map((co) => (
                    <span
                      key={co}
                      className="inline-flex items-center rounded-full border border-border-soft bg-surface-alt px-2.5 py-0.5 text-[11px] text-text"
                    >
                      {co}
                    </span>
                  ))}
                </div>
              ) : (
                <EmptyLine>No portfolio captured yet.</EmptyLine>
              )}
            </ModalSection>

            {/* Team — all partners */}
            <ModalSection heading={`Team (${all_partners.length})`}>
              {all_partners.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {all_partners.map((partner) => (
                    <TeamCard key={partner.id} partner={partner} />
                  ))}
                </div>
              ) : (
                <EmptyLine>
                  No partners on file. The pipeline will populate these
                  overnight.
                </EmptyLine>
              )}
            </ModalSection>

            {/* Synthesis / why them */}
            <ModalSection heading="Why them">
              {synthesisParagraph ? (
                <p className="text-[13px] leading-relaxed text-text">
                  {synthesisParagraph}
                </p>
              ) : (
                <p className="text-[13px] leading-relaxed text-text-dim">
                  Synthesis pending — the nightly pipeline will produce this
                  after the next 06:00 run.
                </p>
              )}
            </ModalSection>
          </div>

          {/* Side column — sparse in Phase 3, richer in Phase 5 */}
          <aside className="flex flex-col gap-3.5">
            <div className="rounded-[10px] border border-border bg-surface-alt p-3.5">
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-dim">
                Campaign context
              </h4>
              <div className="space-y-1.5 text-[12px]">
                {data.campaign?.name ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-text-dim">Campaign</span>
                    <span className="text-right font-medium text-text">
                      {data.campaign.name}
                    </span>
                  </div>
                ) : null}
                {data.campaign?.raise_size ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-text-dim">Raise</span>
                    <span className="text-right font-medium text-text">
                      {data.campaign.raise_size}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            {investor.investment_pattern ? (
              <div className="rounded-[10px] border border-border bg-surface-alt p-3.5">
                <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-dim">
                  Investment pattern
                </h4>
                <p className="text-[11px] leading-relaxed text-text">
                  {investor.investment_pattern}
                </p>
              </div>
            ) : null}
            {investor.team_expertise ? (
              <div className="rounded-[10px] border border-border bg-surface-alt p-3.5">
                <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-text-dim">
                  Team expertise
                </h4>
                <p className="text-[11px] leading-relaxed text-text">
                  {investor.team_expertise}
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>

      {/* ========== FOOT ========== */}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-border bg-surface-alt px-7 py-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-text hover:border-accent hover:text-accent"
        >
          Close
        </button>
        <div className="flex-1" />
        <span className="text-[11px] leading-tight text-text-dim">
          Gmail is authoritative · we never send from this tool
        </span>
        <a
          href={`/tracker/${encodeURIComponent(campaign_partner_id)}/draft`}
          className="rounded-lg border border-accent bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
        >
          Draft email preview ↗
        </a>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ModalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 border-b border-border pb-1.5 text-[12px] font-semibold uppercase tracking-[0.7px] text-accent">
        {heading}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] italic text-text-faint">{children}</p>
  );
}

function PillRow({
  entries,
}: {
  entries: { label: string; value: string | null }[];
}) {
  const filled = entries.filter((e) => !!e.value?.trim());
  if (filled.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {filled.map((entry) => (
        <span
          key={entry.label}
          className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-alt px-2.5 py-0.5 text-[11px]"
        >
          <span className="font-semibold text-text-dim">{entry.label}</span>
          <span className="text-text">{entry.value}</span>
        </span>
      ))}
    </div>
  );
}

function TeamCard({ partner }: { partner: InvestorModalPartner }) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3 text-[12px]">
      <div className="text-[13px] font-semibold text-text">
        {partner.name ?? "Unnamed partner"}
      </div>
      {partner.title ? (
        <div className="mt-0.5 text-[11px] text-text-dim">{partner.title}</div>
      ) : null}
      {partner.bio ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-text">
          {partner.bio}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TierBadge tier={partner.email_tier} />
        {partner.last_contact_at ? (
          <span className="text-[10px] text-text-faint">
            · last contact {formatDaysSince(partner.days_since_last_contact)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
