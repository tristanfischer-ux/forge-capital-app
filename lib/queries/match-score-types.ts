import type { EmailTier } from "@/lib/queries/tracker";

/**
 * Pure types + pure helpers for the V4 §3 match-score surface. Split from
 * `match-score.ts` so the client component `FindAMatch.tsx` can import
 * the type graph + `detectArchetypeSignals` without dragging
 * `next/headers` (via `createServerClient`) into the client bundle.
 *
 * Same sibling-types convention used elsewhere (`match-types.ts` under
 * the old V1 grid). `"use server"` files can only export async functions
 * — everything here is types + sync helpers, so it lives in its own file.
 */

export type Archetype = "investor" | "customer" | "supplier";

export interface ScoreDims {
  thesis: number;
  stage: number;
  geo: number;
  cheque: number;
  activity: number;
  data: number;
}

export interface NearMiss {
  headline: string;
  body: string;
}

export interface ConflictRow {
  firm_name: string;
  /** UUID of the other campaign — used by the "Review conflict →" link
   *  to deep-link into that campaign's tracker view. */
  other_campaign_id: string;
  other_campaign_name: string;
  other_status_code: string | null;
  other_status_label: string | null;
  days_since: number | null;
  primary_contact_name: string | null;
}

/**
 * One portfolio-fit row attached to a matched investor — the most
 * representative companies they've already backed in the founder's
 * sector, lifted from `portfolio_company_profiles` joined via
 * `investor_portfolio_links`. Used by the FindAMatch drill-down so
 * Tristan can see "who else like me did they fund" before approaching.
 */
export interface PortfolioFitRow {
  /** Slug from the canonical `portfolio_companies` table — drives the
   *  `/portfolio/[slug]` link when the page exists. */
  slug: string;
  name: string;
  /** Profile-derived sector tag — broader than the canonical row's
   *  sector field; populated by the dossier synthesiser. */
  sector: string | null;
  /** One-line "what they do" from the dossier. ~120 char target. */
  what_they_do: string | null;
}

export interface MatchResultRow {
  investor_id: number;
  firm_name: string | null;
  hq_location: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
  cheque_min_raw: string | null;
  cheque_max_raw: string | null;
  fund_size_raw: string | null;
  thesis_summary: string | null;
  thesis_deep: string | null;
  ideal_company_profile: string | null;
  dims: ScoreDims;
  match: number;
  primary_partner: {
    id: number;
    name: string | null;
    title: string | null;
    email_tier: EmailTier;
  } | null;
  partner_count: number;
  verified_email_count: number;
  last_contact_days: number | null;
  on_current_campaign: {
    code: string | null;
    label: string | null;
    days: number | null;
  } | null;
  on_other_campaign: ConflictRow | null;
  near_miss: NearMiss | null;
  why_them: string | null;
  investment_pattern: string | null;
  connection_brief: string | null;
  team_expertise: string | null;
  value_add: string | null;
  recent_activity: string | null;
  /** Top-3 portfolio companies the investor has already backed that look
   *  like a sector fit for the founder's pitch. Empty when no overlap or
   *  no dossier rows landed yet. */
  portfolio_fit: PortfolioFitRow[];
}

export interface GetMatchScoreResult {
  rows: MatchResultRow[];
  totalScored: number;
  totalPool: number;
  archetypePoolSize: number;
  firstConflict: ConflictRow | null;
  detectedSignals: string[];
  suggestedArchetype: Archetype;
}

/* ------------------------------------------------------------------------- */
/* Auto-suggest / signal-word detection — pure, safe for the client bundle.  */
/* ------------------------------------------------------------------------- */

const INVESTOR_SIGNALS = [
  /\bseries\s*[a-f]\b/i,
  /\braise\b|\braising\b/i,
  /\bcheque\b|\bcheques\b|\bchecks?\b/i,
  /\binvestor\b|\binvestors\b/i,
  /\bVC\b|\bventure\b|\bangel\b/i,
  /\bpre-?seed\b|\bseed\b/i,
  /[€£$]\s*\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?)?\s*(?:[mMbBkK])?/,
  /\bLP\b|\bfund\b|\bfunds\b/i,
];
const CUSTOMER_SIGNALS = [
  /\bbuyer\b|\bbuyers\b/i,
  /\bpain\b|\bpain point\b/i,
  /\bplatform\b|\bpilot\b/i,
  /\bcustomer\b|\bcustomers\b/i,
  /\bprocurement\b|\bpurchase order\b|\bPO\b/i,
  /\bROI\b|\buse case\b/i,
];
const SUPPLIER_SIGNALS = [
  /\brfq\b/i,
  /\bvendor\b|\bvendors\b/i,
  /\bquote\b|\bquotes\b/i,
  /\bcapacity\b|\blead time\b/i,
  /\bsupplier\b|\bsuppliers\b/i,
  /\bmanufacturing\b|\bcontract manufacturer\b/i,
];

function collectMatches(text: string, patterns: RegExp[], cap: number): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) out.push(m[0]);
    if (out.length >= cap) break;
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const h of out) {
    const key = h.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(h);
    }
  }
  return deduped;
}

export function detectArchetypeSignals(text: string): {
  suggested: Archetype;
  signals: string[];
} {
  const invHits = collectMatches(text, INVESTOR_SIGNALS, 4);
  const cusHits = collectMatches(text, CUSTOMER_SIGNALS, 4);
  const supHits = collectMatches(text, SUPPLIER_SIGNALS, 4);

  const counts: Record<Archetype, number> = {
    investor: invHits.length,
    customer: cusHits.length,
    supplier: supHits.length,
  };
  const suggested: Archetype =
    counts.investor >= counts.customer && counts.investor >= counts.supplier
      ? "investor"
      : counts.customer >= counts.supplier
        ? "customer"
        : "supplier";

  const signals =
    suggested === "investor"
      ? invHits
      : suggested === "customer"
        ? cusHits
        : supHits;
  return { suggested, signals };
}
