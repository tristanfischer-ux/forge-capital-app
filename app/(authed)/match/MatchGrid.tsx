"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TierBadge } from "@/app/(authed)/tracker/TierBadge";
import {
  formatChequeRange,
  type MatchFilters,
  type MatchRow,
  type MatchSortDir,
  type MatchSortKey,
} from "@/lib/queries/match-types";
import { shortlistInvestor, shortlistTopN } from "./actions";

/**
 * Match-list grid — mockup-faithful port of Phase2-Mockup-V4 §"Find a
 * match" results grid (lines 972–1146) with the two round-2
 * corrections:
 *
 *   - No per-row checkboxes. A single "Shortlist top N" control at
 *     the top runs the active query and inserts the top N rows at
 *     +0 Pending approval.
 *   - Two sentences of company + partner context visible under each
 *     card without clicking, plus the why-them synthesis (same text
 *     as the tracker modal). Click-to-expand shows the full why-them.
 *
 * Client component because the top-N confirmation + per-row "Add"
 * button need local state and useTransition for the server-action
 * round-trip.
 */

export interface MatchGridProps {
  rows: MatchRow[];
  total: number;
  page: number;
  pageSize: number;
  campaignId: string;
  campaignName: string;
  filters: MatchFilters;
  sortKey: MatchSortKey;
  sortDir: MatchSortDir;
  includeExisting: boolean;
}

export function MatchGrid({
  rows,
  total,
  page,
  pageSize,
  campaignId,
  campaignName,
  filters,
  sortKey,
  sortDir,
  includeExisting,
}: MatchGridProps) {
  const router = useRouter();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [n, setN] = useState<number>(20);
  const [confirmingN, setConfirmingN] = useState<boolean>(false);
  const [isBulkPending, startBulkTransition] = useTransition();
  const [isRowPending, startRowTransition] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<number | null>(null);
  const [toast, setToast] = useState<
    | { kind: "ok"; shortlisted: number; skipped: Array<{ name: string; reason: string }> }
    | { kind: "err"; message: string }
    | null
  >(null);

  const from = page * pageSize;
  const to = Math.min(from + pageSize, total);
  const shownLo = total === 0 ? 0 : from + 1;
  const shownHi = to;
  const hasPrev = page > 0;
  const hasNext = to < total;

  function goToPage(nextPage: number) {
    // Mutate the search params directly so filters are preserved.
    const url = new URL(window.location.href);
    url.searchParams.set("p", String(nextPage));
    router.push(`/match${url.search}`);
  }

  function onShortlistTopN() {
    if (!confirmingN) {
      setConfirmingN(true);
      return;
    }
    setToast(null);
    startBulkTransition(async () => {
      const out = await shortlistTopN({
        campaignId,
        filters,
        includeExisting,
        sortKey,
        sortDir,
        n,
      });
      setConfirmingN(false);
      if (out.ok) {
        setToast({
          kind: "ok",
          shortlisted: out.shortlisted.length,
          skipped: out.skipped,
        });
        // Force a server refetch — revalidatePath already ran, but the
        // router needs a prompt to re-render the server component.
        router.refresh();
      } else {
        setToast({ kind: "err", message: out.error });
      }
    });
  }

  function onShortlistOne(investorId: number) {
    if (isRowPending) return;
    setPendingRowId(investorId);
    setToast(null);
    startRowTransition(async () => {
      const out = await shortlistInvestor({ campaignId, investorId });
      setPendingRowId(null);
      if (out.ok) {
        setToast({
          kind: "ok",
          shortlisted: out.shortlisted.length,
          skipped: out.skipped,
        });
        router.refresh();
      } else {
        setToast({ kind: "err", message: out.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Shortlist top-N control — mockup's batch bar reshaped to
          round-2's "single control, no per-row checkboxes". */}
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#e4e1ff] bg-accent-softer px-4 py-3 text-[12px]">
        <span className="font-semibold text-accent-dark">
          Shortlist top{" "}
          <input
            type="number"
            min={1}
            max={100}
            value={n}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setN(Math.max(1, Math.min(100, Math.floor(v))));
              // Any change to N cancels the confirm state so the user
              // doesn't accidentally confirm against a changed number.
              setConfirmingN(false);
            }}
            className="mx-1.5 inline-block w-14 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-center text-[12px] font-semibold tabular-nums text-accent focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={isBulkPending}
          />
          investors by match order
        </span>
        <span className="text-text-dim">
          · adds them at <code className="rounded-sm bg-surface px-1 py-0.5 font-mono text-[11px]">+0 Pending approval</code>
        </span>
        <span className="flex-1" />
        {confirmingN ? (
          <>
            <span className="text-[11px] font-medium text-text-dim">
              Shortlist {n} to {campaignName}?
            </span>
            <button
              type="button"
              onClick={onShortlistTopN}
              disabled={isBulkPending}
              className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-dark disabled:opacity-60"
            >
              {isBulkPending ? "Working…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingN(false)}
              disabled={isBulkPending}
              className="rounded-sm border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text-dim hover:border-accent hover:text-accent"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onShortlistTopN}
            className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-dark"
          >
            Shortlist top {n}
          </button>
        )}
      </div>

      {toast ? (
        <div
          className={`rounded-[10px] border px-4 py-3 text-[12px] ${
            toast.kind === "ok"
              ? "border-[#bbf7d0] bg-green-light text-green"
              : "border-[#fecaca] bg-red-light text-red"
          }`}
        >
          {toast.kind === "ok" ? (
            <>
              <div className="font-semibold">
                Shortlisted {toast.shortlisted}{" "}
                {toast.shortlisted === 1 ? "investor" : "investors"}.
              </div>
              {toast.skipped.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-text-dim">
                  {toast.skipped.map((s, i) => (
                    <li key={i}>
                      Skipped <span className="font-medium">{s.name}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div>
              <span className="font-semibold">Could not shortlist.</span>{" "}
              {toast.message}
            </div>
          )}
        </div>
      ) : null}

      {/* Results grid */}
      <div className="overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[#e4e1ff] bg-accent-softer px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-accent-dark">Matched investors</span>
            <span className="text-text-dim">
              · {total} {total === 1 ? "firm" : "firms"} match
              {includeExisting ? " (including those already in this campaign)" : ", existing campaign members hidden"}
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyResults includeExisting={includeExisting} />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                <th
                  scope="col"
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                  style={{ width: "14%" }}
                >
                  Tier
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                  style={{ width: "22%" }}
                >
                  Firm · Contact
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                  style={{ width: "22%" }}
                >
                  Sector · Stage · Geo
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                  style={{ width: "12%" }}
                >
                  Cheque
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                >
                  Company + investor context · Why them
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-dim"
                  style={{ width: "8%" }}
                >
                  Add
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = expandedId === row.investor_id;
                const isThisRowPending = isRowPending && pendingRowId === row.investor_id;
                return (
                  <Fragment key={row.investor_id}>
                    <tr
                      className="cursor-pointer border-b border-border-soft align-top last:border-b-0 hover:bg-surface-alt"
                      onClick={() =>
                        setExpandedId((current) =>
                          current === row.investor_id ? null : row.investor_id,
                        )
                      }
                    >
                      <td className="px-3 py-2.5">
                        <TierBadge tier={row.primary_partner?.email_tier ?? null} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-[12px] font-semibold text-text">
                          {row.firm_name ?? "—"}
                          {row.already_in_campaign ? (
                            <span className="ml-1.5 inline-flex items-center rounded-full border border-chip-warn-border bg-chip-warn-bg px-1.5 py-0.5 align-middle text-[10px] font-medium text-chip-warn-fg">
                              Already in campaign
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-dim">
                          {row.primary_partner?.name ?? (
                            <span className="italic text-text-faint">
                              No partner on file
                            </span>
                          )}
                          {row.primary_partner?.title ? (
                            <span className="text-text-faint">
                              {" · "}
                              {row.primary_partner.title}
                            </span>
                          ) : null}
                        </div>
                        {row.hq_location ? (
                          <div className="mt-0.5 text-[10px] text-text-faint">
                            {row.hq_location}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <Chip label={row.sector_focus} kind="sector" />
                          <Chip label={row.stage_focus} kind="stage" />
                          <Chip label={row.geo_focus} kind="geo" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] tabular-nums text-text">
                        {formatChequeRange(row.cheque_min_usd, row.cheque_max_usd) ?? (
                          <span className="italic text-text-faint">—</span>
                        )}
                      </td>
                      <td className="max-w-[460px] px-3 py-2.5 text-[11px] leading-relaxed text-text">
                        <div>
                          {row.company_summary ?? (
                            <span className="italic text-text-faint">
                              No company context on file yet.
                            </span>
                          )}
                        </div>
                        {row.why_them ? (
                          <div
                            className={`mt-1.5 rounded-[6px] border border-border-soft bg-surface-alt px-2.5 py-1.5 ${
                              expanded ? "" : "line-clamp-2"
                            }`}
                          >
                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                              Why them
                            </div>
                            <div className="text-[11px] text-text">
                              {row.why_them}
                            </div>
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onShortlistOne(row.investor_id)}
                          disabled={isThisRowPending || row.already_in_campaign}
                          className="rounded-sm bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            row.already_in_campaign
                              ? "Already on this campaign"
                              : "Shortlist at +0 Pending approval"
                          }
                        >
                          {isThisRowPending ? "…" : "Add →"}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr
                        className="border-b border-border-soft last:border-b-0 bg-surface-alt"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <td colSpan={6} className="px-4 py-3">
                          <ExpandedBlock row={row} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {total > 0 ? (
        <div className="flex items-center justify-between rounded-[10px] border border-border bg-surface px-4 py-2.5 text-[11px] shadow-[var(--shadow)]">
          <span className="text-text-dim">
            Showing{" "}
            <span className="font-semibold tabular-nums text-text">
              {shownLo}–{shownHi}
            </span>{" "}
            of{" "}
            <span className="font-semibold tabular-nums text-text">{total}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={!hasPrev}
              className="rounded-sm border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-dim hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={!hasNext}
              className="rounded-sm border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-dim hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyResults({ includeExisting }: { includeExisting: boolean }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="text-[13px] font-semibold text-text">
        No investors match your filters.
      </div>
      <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-text-dim">
        Try relaxing sector or stage.
        {!includeExisting ? (
          <>
            {" "}
            Firms already in this campaign are hidden by default — toggle
            “Also show investors already in this campaign” above to include
            them.
          </>
        ) : null}
      </p>
    </div>
  );
}

function Chip({
  label,
  kind,
}: {
  label: string | null;
  kind: "sector" | "stage" | "geo";
}) {
  if (!label || label.trim().length === 0) return null;
  const kindLabel =
    kind === "sector" ? "Sector" : kind === "stage" ? "Stage" : "Geo";
  return (
    <span
      className="inline-flex items-center rounded-full border border-border-soft bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-text-dim"
      title={`${kindLabel}: ${label}`}
    >
      <span className="mr-1 text-[9px] uppercase tracking-wide text-text-faint">
        {kindLabel.slice(0, 3)}
      </span>
      {label}
    </span>
  );
}

function ExpandedBlock({ row }: { row: MatchRow }) {
  // Full why-them panel (non-clamped), plus a shallow summary of the
  // fund's cheque + HQ so the operator has the key facts visible while
  // deciding whether to shortlist. No fabrication — blank rows stay blank.
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Company context
        </div>
        <div className="text-[11px] leading-relaxed text-text">
          {row.company_summary ?? (
            <span className="italic text-text-faint">
              No company context on file yet.
            </span>
          )}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <dt className="text-text-faint">HQ</dt>
          <dd className="text-text">{row.hq_location ?? "—"}</dd>
          <dt className="text-text-faint">Fund size</dt>
          <dd className="text-text">
            {row.fund_size_usd != null
              ? formatChequeRange(row.fund_size_usd, row.fund_size_usd)?.replace("$", "$ ")
              : "—"}
          </dd>
          <dt className="text-text-faint">Cheque</dt>
          <dd className="text-text">
            {formatChequeRange(row.cheque_min_usd, row.cheque_max_usd) ?? "—"}
          </dd>
        </dl>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Why them
        </div>
        <div className="rounded-[6px] border border-border-soft bg-surface px-3 py-2 text-[11px] leading-relaxed text-text">
          {row.why_them ?? (
            <span className="italic text-text-faint">
              No synthesis on file yet — runs during the nightly Forge Capital pipeline.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
