import type { EmailTier } from "@/lib/queries/tracker";

/**
 * Pure types + formatters for the match-list surface. Split from
 * `match.ts` so the client grid can import format helpers without
 * dragging `next/headers` (via `createServerClient`) into a client
 * bundle. Matches the `"use server"` / sibling-types convention we
 * use elsewhere in this repo.
 */

export type MatchSortKey = "firm_name" | "last_synced";
export type MatchSortDir = "asc" | "desc";

export interface MatchFilters {
  sector?: string | null;
  stage?: string | null;
  geo?: string | null;
  thesis?: string | null;
}

export interface MatchRow {
  investor_id: number;
  firm_name: string | null;
  hq_location: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
  cheque_min_usd: number | null;
  cheque_max_usd: number | null;
  fund_size_usd: number | null;
  primary_partner: {
    id: number;
    name: string | null;
    title: string | null;
    email_tier: EmailTier;
  } | null;
  company_summary: string | null;
  why_them: string | null;
  already_in_campaign: boolean;
}

/**
 * Formats a cheque range like "$500K – $5M" from raw USD numbers.
 * Pure — no I/O — so the client grid can use it directly.
 */
export function formatChequeRange(
  minUsd: number | null,
  maxUsd: number | null,
): string | null {
  const parts = [minUsd, maxUsd].map((n) => (n == null ? null : formatUsd(n)));
  if (parts[0] === null && parts[1] === null) return null;
  if (parts[0] !== null && parts[1] !== null) return `${parts[0]} – ${parts[1]}`;
  if (parts[0] !== null) return `from ${parts[0]}`;
  return `up to ${parts[1]}`;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
