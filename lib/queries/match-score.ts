import { createServerClient } from "@/lib/supabase/server";
import { deriveWhyThem } from "@/lib/queries/tracker";
import type { EmailTier } from "@/lib/queries/tracker";
import type {
  Archetype,
  ScoreDims,
  NearMiss,
  ConflictRow,
  MatchResultRow,
  GetMatchScoreResult,
} from "@/lib/queries/match-score-types";
import { detectArchetypeSignals } from "@/lib/queries/match-score-types";
import { embedQueryText } from "@/lib/embeddings/openai";

/**
 * Match-scoring query for §3 "Find a Match" — V4 lines 913–1147.
 *
 * Input: free-text `heroText` (founder's pitch) + an archetype + a campaignId.
 * Output: top-N investors with a 6-dimension scorecard per row
 *   (THESIS / STAGE / GEO / CHEQUE / ACTIVITY / DATA) + the rollup `match`
 *   percentage + the primary-partner chip + any near-miss callout text.
 *
 * V1 scoring algorithm is deliberately simple — word-overlap + keyword
 * detection. No embeddings wired yet (the Forge Capital pipeline uses
 * nomic-embed-text 768-dim locally but those vectors are NOT in
 * apex-outreach Supabase; the push script doesn't carry them). The visual
 * output is what matters for V4 parity; algorithm tuning lands separately
 * once the embedding substrate is in place. Flagged throughout this file
 * as TODO(embeddings).
 *
 * Pure types + `detectArchetypeSignals` live in `match-score-types.ts`
 * so the client `FindAMatch.tsx` can import them without dragging
 * `next/headers` into a client bundle.
 */

// Re-export the pure types for any server-only caller that wants to
// `import from "@/lib/queries/match-score"`. Everything server-only
// below needs no re-export.
export type {
  Archetype,
  ScoreDims,
  NearMiss,
  ConflictRow,
  MatchResultRow,
  GetMatchScoreResult,
};
export { detectArchetypeSignals };

export interface GetMatchScoreOptions {
  heroText: string;
  archetype: Archetype;
  campaignId: string;
  /** How many top-scored rows to return. V4 shows 5 top + "+5 more". V1 returns top 10; enhancement wave (2026-04-22) defaults to 25. */
  limit?: number;
  /** How many raw candidates to score in Node. Default 2000 (raised from 600 on 2026-04-22 to give full ~9.3k-pool visibility per page). */
  candidatePool?: number;
  /** Sort tab: best match / thesis only / near-miss. */
  tab?: "best" | "thesis" | "near_miss";
  /** Minimum match score to include (from batch-bar toggle). 0-100. */
  minMatch?: number;
  /** Hide firms that already had any contact in this campaign (+3 Email sent onwards). */
  hideContacted?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Main scoring query                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Tokenise free text into lowercased words, dropping short stopwords.
 * Used for the simple word-overlap thesis score in V1.
 */
function tokenise(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  const stopwords = new Set([
    "the","a","an","and","or","but","of","to","in","on","for","with","by","at","is","are","was","were","be","been","being","we","you","our","your","their","they","this","that","these","those","it","its","from","as","has","have","had","not","no","do","does","will","can","may","so","if","when","where","why","how","who","what","than","then","also","just","more","most","some","any","all","into","out","over","under","up","down",
  ]);
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9€£$\-\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopwords.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function parseAmountUsd(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Match strings like "~$4,320,000", "€1M", "$2.5b", "£500k".
  const s = raw.toLowerCase().replace(/[, ]/g, "");
  const m = s.match(/([€£$~]?)([\d.]+)\s*([kmb]?)/);
  if (!m) return null;
  const base = parseFloat(m[2]);
  if (!Number.isFinite(base)) return null;
  const unit = m[3];
  const mult = unit === "b" ? 1e9 : unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1;
  // Treat £/€ ≈ $ for V1. Over/under by ~10% is within the noise of the
  // word-overlap score. TODO(currency): proper FX conversion.
  return base * mult;
}

function parseChequeRangeFromText(text: string): { min: number | null; max: number | null } {
  // Matches "€20-30m" / "£500k-1m" / "$5m+" / "€20m" etc.
  const range = text.match(/([€£$])\s*(\d+(?:\.\d+)?)\s*[–\-to]+\s*(\d+(?:\.\d+)?)\s*([kmb])/i);
  if (range) {
    const cur = range[1];
    const u = range[4].toLowerCase();
    const min = parseAmountUsd(`${cur}${range[2]}${u}`);
    const max = parseAmountUsd(`${cur}${range[3]}${u}`);
    return { min, max };
  }
  const single = text.match(/([€£$])\s*(\d+(?:\.\d+)?)\s*([kmb])/i);
  if (single) {
    const cur = single[1];
    const u = single[3].toLowerCase();
    const amt = parseAmountUsd(`${cur}${single[2]}${u}`);
    return { min: amt, max: amt };
  }
  return { min: null, max: null };
}

/**
 * Stage detection from heroText. V1: regex-spot keywords and return the
 * stages the text "wants". The investor's `stage_focus` is free text so
 * we check substring presence both directions.
 */
function detectStages(text: string): string[] {
  const t = text.toLowerCase();
  const stages: string[] = [];
  if (/\bpre-?seed\b/.test(t)) stages.push("pre-seed");
  if (/\bseed\b/.test(t)) stages.push("seed");
  if (/\bseries\s*a\b/.test(t)) stages.push("series a");
  if (/\bseries\s*b\b/.test(t)) stages.push("series b");
  if (/\bseries\s*c\b/.test(t)) stages.push("series c");
  if (/\bgrowth\b/.test(t)) stages.push("growth");
  return stages;
}

/**
 * Geo detection — coarse two-letter region match.
 * Returns the lowercased region tokens found in the text.
 */
function detectGeos(text: string): string[] {
  const t = text.toLowerCase();
  const geos: string[] = [];
  const phrases: [RegExp, string][] = [
    [/\buk\b|\bunited kingdom\b|\bbritain\b|\blondon\b/, "uk"],
    [/\beu\b|\beurope(an)?\b|\bgermany\b|\bfrance\b|\bspain\b|\bitaly\b/, "eu"],
    [/\bus\b|\busa\b|\bunited states\b|\bamerica\b|\bsan francisco\b|\bnew york\b|\bwest coast\b/, "us"],
    [/\basia\b|\bchina\b|\bjapan\b|\bsingapore\b|\bindia\b|\bsouth-?east asia\b/, "asia"],
    [/\bafrica\b|\bmiddle east\b|\bMENA\b|\bmauritius\b/i, "other"],
  ];
  for (const [r, label] of phrases) if (r.test(t)) geos.push(label);
  return Array.from(new Set(geos));
}

function substrateHas(needle: string | null | undefined, text: string): boolean {
  if (!needle) return false;
  return needle.toLowerCase().includes(text.toLowerCase());
}

function scoreDims(
  investor: {
    thesis_summary: string | null;
    stage_focus: string | null;
    geo_focus: string | null;
    cheque_min_usd: string | null;
    cheque_max_usd: string | null;
    synthesized_at: string | null;
    last_enriched: string | null;
    chrome_verified: boolean | null;
    hq_location: string | null;
    sector_focus: string | null;
  },
  heroTokens: Set<string>,
  heroText: string,
  wantedStages: string[],
  wantedGeos: string[],
  heroCheque: { min: number | null; max: number | null },
): ScoreDims {
  // THESIS: jaccard of hero tokens against (sector_focus + thesis_summary).
  const thesisBag = tokenise(
    `${investor.sector_focus ?? ""} ${investor.thesis_summary ?? ""}`,
  );
  const thesisScore = Math.round(Math.min(100, jaccard(heroTokens, thesisBag) * 180 + 30));

  // STAGE: does investor.stage_focus mention the wanted stages?
  let stageScore = 50; // neutral
  if (wantedStages.length > 0) {
    const sf = (investor.stage_focus ?? "").toLowerCase();
    const hits = wantedStages.filter((s) => sf.includes(s)).length;
    if (sf.length === 0) {
      stageScore = 50;
    } else if (hits === 0) {
      // Check adjacency — investor at seed + we want Series A is a near-miss
      // rather than a zero. Strong red: pre-seed only when wanting Series B+.
      const prev = wantedStages.some((s) => {
        if (s === "series a") return /pre-?seed|seed/.test(sf) && !/series\s*a/.test(sf);
        if (s === "series b") return /series\s*a|seed/.test(sf) && !/series\s*b/.test(sf);
        return false;
      });
      stageScore = prev ? 38 : 25;
    } else {
      stageScore = Math.round(60 + (hits / wantedStages.length) * 35);
    }
  }

  // GEO: overlap between wanted geos and investor.geo_focus + hq_location.
  let geoScore = 60;
  if (wantedGeos.length > 0) {
    const gf = `${investor.geo_focus ?? ""} ${investor.hq_location ?? ""}`.toLowerCase();
    const geoKeywords: Record<string, string[]> = {
      uk: ["uk", "united kingdom", "britain", "london", "europe"],
      eu: ["eu", "europe", "germany", "france", "spain", "italy", "netherlands", "united kingdom"],
      us: ["us", "usa", "united states", "america", "california", "new york"],
      asia: ["asia", "china", "japan", "singapore", "india", "south-east", "south east"],
      other: ["global", "worldwide", "africa", "middle east"],
    };
    let hits = 0;
    for (const w of wantedGeos) {
      const kws = geoKeywords[w] ?? [];
      if (kws.some((k) => gf.includes(k))) hits++;
    }
    geoScore = hits === 0 ? 30 : Math.round(55 + (hits / wantedGeos.length) * 40);
  }

  // CHEQUE: overlap of hero cheque range with investor min/max.
  let chequeScore = 60;
  const invMin = parseAmountUsd(investor.cheque_min_usd);
  const invMax = parseAmountUsd(investor.cheque_max_usd);
  if (heroCheque.min !== null && heroCheque.max !== null && (invMin !== null || invMax !== null)) {
    const loI = invMin ?? 0;
    const hiI = invMax ?? Number.POSITIVE_INFINITY;
    const loH = heroCheque.min;
    const hiH = heroCheque.max;
    const overlaps = loI <= hiH && hiI >= loH;
    if (overlaps) {
      chequeScore = 85;
    } else {
      // Distance metric — how far off is the investor range? Order of magnitude.
      const gap =
        Math.min(
          Math.abs(Math.log10(Math.max(loI, 1)) - Math.log10(Math.max(hiH, 1))),
          Math.abs(Math.log10(Math.max(hiI, 1)) - Math.log10(Math.max(loH, 1))),
        );
      chequeScore = gap < 0.5 ? 60 : gap < 1 ? 45 : 30;
    }
  } else if (invMin === null && invMax === null) {
    // Investor cheque unknown — don't penalise too harshly.
    chequeScore = 55;
  }

  // ACTIVITY: inverse of days since synthesized_at or last_enriched.
  const freshness = investor.synthesized_at ?? investor.last_enriched ?? null;
  let activityScore = 50;
  if (freshness) {
    const ts = Date.parse(freshness);
    if (Number.isFinite(ts)) {
      const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (ageDays < 7) activityScore = 90;
      else if (ageDays < 30) activityScore = 78;
      else if (ageDays < 90) activityScore = 65;
      else if (ageDays < 180) activityScore = 50;
      else activityScore = 35;
    }
  }

  // DATA: non-null field density + chrome_verified bonus.
  const dataFields = [
    investor.thesis_summary,
    investor.sector_focus,
    investor.stage_focus,
    investor.geo_focus,
    investor.cheque_min_usd ?? investor.cheque_max_usd,
    investor.hq_location,
  ];
  const filled = dataFields.filter((v) => v !== null && v !== undefined && String(v).trim().length > 0).length;
  let dataScore = Math.round((filled / dataFields.length) * 70 + 15);
  if (investor.chrome_verified === true) dataScore = Math.min(100, dataScore + 10);

  // Avoid accidental out-of-range
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  // Small noise so equal-looking rows still sort deterministically via id.
  return {
    thesis: clamp(thesisScore),
    stage: clamp(stageScore),
    geo: clamp(geoScore),
    cheque: clamp(chequeScore),
    activity: clamp(activityScore),
    data: clamp(dataScore),
  };
}

function dimAverage(d: ScoreDims): number {
  return Math.round((d.thesis + d.stage + d.geo + d.cheque + d.activity + d.data) / 6);
}

function pickNearMiss(
  row: Partial<MatchResultRow> & {
    dims: ScoreDims;
    firm_name: string | null;
    stage_focus: string | null;
    geo_focus?: string | null;
    sector_focus?: string | null;
    thesis_summary?: string | null;
    cheque_min_raw?: string | null;
    cheque_max_raw?: string | null;
  },
  pitchTokens?: Set<string>,
  pitchStages?: string[],
): NearMiss | null {
  const d = row.dims;
  const entries: Array<[keyof ScoreDims, number]> = [
    ["thesis", d.thesis],
    ["stage", d.stage],
    ["geo", d.geo],
    ["cheque", d.cheque],
    ["activity", d.activity],
    ["data", d.data],
  ];
  entries.sort((a, b) => a[1] - b[1]);
  const [weakKey, weakVal] = entries[0];
  const others = entries.slice(1).map(([, v]) => v);
  const avg = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
  if (weakVal >= 55) return null;
  if (avg - weakVal < 18) return null;

  const firm = row.firm_name ?? "this firm";
  const stage = (row.stage_focus ?? "").toLowerCase().trim();
  const geo = (row.geo_focus ?? "").trim();
  const sector = (row.sector_focus ?? "").trim();

  switch (weakKey) {
    case "stage": {
      // Name both sides explicitly so Tristan can judge.
      const firmStages = stage || "a stage we couldn't parse";
      const pitchStageList = pitchStages && pitchStages.length > 0
        ? pitchStages.join(" / ")
        : "the stage your pitch implies";
      return {
        headline: "Near-miss: weak stage fit.",
        body: `${firm} focuses on ${firmStages}; your pitch reads as ${pitchStageList}. Good for follow-on, not lead.`,
      };
    }
    case "geo": {
      const firmGeo = geo || "geographies we couldn't parse from their profile";
      return {
        headline: "Near-miss: weak geo fit.",
        body: `${firm} deploys into ${firmGeo}. Check for a recent sister-fund or LP introduction before cold outreach.`,
      };
    }
    case "thesis": {
      // Surface the pitch tokens NOT present in the firm's thesis.
      const firmBlurb = (row.thesis_summary ?? "") + " " + sector;
      const firmTokens = new Set(
        firmBlurb.toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 4),
      );
      const missing = pitchTokens
        ? Array.from(pitchTokens).filter((t) => !firmTokens.has(t)).slice(0, 4)
        : [];
      const firmSectors = sector
        ? `their stated focus is ${sector.split(",").slice(0, 3).join(", ")}`
        : "we don't have a parsed sector list for them";
      const missingFrag =
        missing.length > 0
          ? `Your pitch emphasises ${missing.join(", ")} — those don't appear in ${firm}'s public remit. `
          : "";
      return {
        headline: "Near-miss: weak thesis overlap.",
        body: `${missingFrag}${firm}: ${firmSectors}. Ask if a team member has written on an adjacent theme before approaching cold.`,
      };
    }
    case "cheque": {
      const minR = (row.cheque_min_raw ?? "").trim();
      const maxR = (row.cheque_max_raw ?? "").trim();
      const firmRange =
        minR || maxR ? [minR, maxR].filter(Boolean).join("–") : "an unknown range";
      return {
        headline: "Near-miss: cheque size off.",
        body: `${firm}'s typical cheque (${firmRange}) doesn't line up with the round size you described. Consider them for a follow-on slot rather than the lead.`,
      };
    }
    case "activity":
      return {
        headline: "Near-miss: stale profile.",
        body: `${firm} hasn't refreshed its public thesis recently — last signal from us is old. Confirm they're still deploying before investing time in outreach.`,
      };
    case "data":
      return {
        headline: "Near-miss: thin data on file.",
        body: `We only have partial profile data for ${firm} — thesis, sector, or stage fields are empty. Do a manual website pass before outreach.`,
      };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Public entry point                                                        */
/* ------------------------------------------------------------------------- */

interface CandidateRow {
  id: number;
  firm_name: string | null;
  hq_location: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
  cheque_min_usd: string | null;
  cheque_max_usd: string | null;
  fund_size_usd: string | null;
  thesis_summary: string | null;
  thesis_deep: string | null;
  ideal_company_profile: string | null;
  synthesis_data: unknown;
  investment_pattern: string | null;
  connection_brief: string | null;
  team_expertise: string | null;
  synthesized_at: string | null;
  last_enriched: string | null;
  chrome_verified: boolean | null;
  last_synced_at: string | null;
  partners_mirror: Array<{
    id: number;
    name: string | null;
    title: string | null;
    email_tier: string | null;
    is_primary_contact: boolean | null;
    email: string | null;
  }>;
}

export async function getArchetypePoolSizes(): Promise<{ investor: number; customer: number; supplier: number }> {
  // V1 only has the investor mirror wired up. Customer + supplier mirrors
  // ship later — return null counts so the UI can say "— coming soon".
  const supabase = await createServerClient();
  const { count } = await supabase
    .from("investors_mirror")
    .select("*", { count: "exact", head: true })
    .eq("actively_deploying", true);
  return { investor: count ?? 0, customer: 0, supplier: 0 };
}

export async function getMatchScore(
  opts: GetMatchScoreOptions,
): Promise<GetMatchScoreResult> {
  const {
    heroText,
    archetype,
    campaignId,
    limit = 25,
    candidatePool = 2000,
    tab = "best",
    minMatch = 0,
    hideContacted = true,
  } = opts;

  const supabase = await createServerClient();

  // Auto-suggest runs on every call so the banner can update live server-side.
  const { suggested, signals } = detectArchetypeSignals(heroText);

  // V1 only supports the investor archetype end-to-end. Customer + supplier
  // mirrors are not yet populated in apex-outreach. When the user picks
  // one of those, return an empty result with the suggested/signals set
  // so the UI can render the "coming soon" empty state + the auto-suggest
  // banner still works.
  if (archetype !== "investor") {
    return {
      rows: [],
      totalScored: 0,
      totalPool: 0,
      archetypePoolSize: 0,
      firstConflict: null,
      detectedSignals: signals,
      suggestedArchetype: suggested,
    };
  }

  // Step 1: figure out which investors are already in the CURRENT campaign
  // (for the "show all" toggle) and which are active in OTHER campaigns
  // within 14 days (for the conflict banner).
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [cpCurrentRes, cpOtherRes, poolSize] = await Promise.all([
    // Current campaign: all campaign_partners rows with investor_id.
    supabase
      .from("campaign_partners")
      .select(
        `
        id, status_code, status_label, last_contact_at,
        partners_mirror:partner_id (
          id, name, investor_id
        )
        `,
      )
      .eq("campaign_id", campaignId),
    // Other campaigns, within 14 days of last_contact_at or created_at.
    // For V1 we use last_contact_at — the 14-day rule is about a recent
    // ask, not about ancient rows. Rows without a last_contact_at are ignored.
    supabase
      .from("campaign_partners")
      .select(
        `
        id, status_code, status_label, last_contact_at, campaign_id,
        campaigns:campaign_id ( id, name ),
        partners_mirror:partner_id ( id, name, investor_id )
        `,
      )
      .neq("campaign_id", campaignId)
      .gte("last_contact_at", fourteenDaysAgo.toISOString()),
    getArchetypePoolSizes(),
  ]);

  if (cpCurrentRes.error) {
    console.error("match-score cp-current failed:", cpCurrentRes.error.message);
  }
  if (cpOtherRes.error) {
    console.error("match-score cp-other failed:", cpOtherRes.error.message);
  }

  // Shape the current-campaign index: investor_id → (status + days)
  interface CurrentIdx {
    code: string | null;
    label: string | null;
    days: number | null;
  }
  const currentByInvestor = new Map<number, CurrentIdx>();
  for (const row of (cpCurrentRes.data ?? []) as unknown as Array<{
    status_code: string | null;
    status_label: string | null;
    last_contact_at: string | null;
    partners_mirror: { investor_id: number } | null;
  }>) {
    const pm = row.partners_mirror;
    if (!pm || typeof pm !== "object") continue;
    const invId = (pm as { investor_id: number }).investor_id;
    if (typeof invId !== "number") continue;
    const days = row.last_contact_at
      ? Math.floor(
          (Date.now() - new Date(row.last_contact_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;
    currentByInvestor.set(invId, {
      code: row.status_code,
      label: row.status_label,
      days,
    });
  }

  // Shape the other-campaign index: investor_id → first conflict row seen.
  interface OtherRowShape {
    status_code: string | null;
    status_label: string | null;
    last_contact_at: string | null;
    campaigns: { id: string; name: string } | null;
    partners_mirror: { id: number; name: string | null; investor_id: number } | null;
  }
  const otherByInvestor = new Map<number, ConflictRow>();
  for (const row of (cpOtherRes.data ?? []) as unknown as OtherRowShape[]) {
    const pm = row.partners_mirror;
    const camp = row.campaigns;
    if (!pm || !camp) continue;
    const invId = (pm as { investor_id: number }).investor_id;
    if (typeof invId !== "number") continue;
    if (otherByInvestor.has(invId)) continue;
    const days = row.last_contact_at
      ? Math.floor(
          (Date.now() - new Date(row.last_contact_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;
    otherByInvestor.set(invId, {
      firm_name: "", // filled after we resolve the investor
      other_campaign_id: (camp as { id: string }).id,
      other_campaign_name: (camp as { name: string }).name,
      other_status_code: row.status_code,
      other_status_label: row.status_label,
      days_since: days,
      primary_contact_name: (pm as { name: string | null }).name,
    });
  }

  // Step 2: pick a candidate pool. Two strategies, chosen at runtime:
  //
  // HYBRID (when REPLICATE_API_TOKEN is present AND investor rows have
  // embeddings populated): embed the founder's pitch via Replicate-hosted
  // nomic-embed-text, then use the `match_investors_by_embedding` RPC to
  // pull the top `candidatePool` investors by cosine similarity. Those
  // become the pool the lexical reranker chews through. Matches the
  // quality of Forge Capital's static dashboard (same 768-dim model).
  //
  // LEXICAL (fallback): pull `candidatePool` rows by `synthesized_at`
  // freshness. The legacy V1 behaviour — still scores correctly, just
  // with a less-relevant candidate set. Kicks in when there's no
  // Replicate token, no embedded rows, or the Replicate call errors.
  //
  // Either way, we also exclude firms already on the CURRENT campaign
  // (the V4 default "already-contacted hidden") unless the caller
  // opts out via `hideContacted=false`.
  const existingIds = Array.from(currentByInvestor.keys());
  const excludeIds = hideContacted ? existingIds.slice(0, 2000) : [];

  // Try the embedding route first. Fail silently to lexical on any error.
  let annIds: number[] | null = null;
  let embedInfo: { dims: number; latencyMs: number } | null = null;
  const embedResult = await embedQueryText(heroText);
  if (embedResult.ok) {
    embedInfo = { dims: embedResult.dims, latencyMs: embedResult.latencyMs };
    const { data: annRows, error: annErr } = await supabase.rpc(
      "match_investors_by_embedding",
      {
        query_embedding: embedResult.vector,
        match_count: Math.min(candidatePool, 2000),
      },
    );
    if (annErr) {
      console.warn(
        "[match-score] ANN RPC failed, falling back to lexical:",
        annErr.message,
      );
    } else {
      const rows = (annRows ?? []) as Array<{ id: number }>;
      annIds = rows
        .map((r) => r.id)
        .filter((id) => !excludeIds.includes(id))
        .slice(0, candidatePool);
    }
  } else if (embedResult.kind !== "no_token") {
    // no_token is expected in dev without the key — don't spam the logs.
    console.warn(
      "[match-score] Replicate embedding failed, falling back to lexical:",
      embedResult.error,
    );
  }

  const usingHybrid = annIds !== null && annIds.length > 0;

  let candidatesQuery = supabase
    .from("investors_mirror")
    .select(
      `
      id, firm_name, hq_location, sector_focus, stage_focus, geo_focus,
      cheque_min_usd, cheque_max_usd, fund_size_usd,
      thesis_summary, thesis_deep, ideal_company_profile,
      synthesis_data, investment_pattern, connection_brief,
      team_expertise, synthesized_at, last_enriched,
      chrome_verified, last_synced_at,
      partners_mirror:partners_mirror!partners_mirror_investor_id_fkey (
        id, name, title, email_tier, is_primary_contact, email
      )
      `,
    )
    .eq("actively_deploying", true);

  if (usingHybrid) {
    // Fetch exactly the semantically-similar ids. Order is lost on the
    // `.in()` PostgREST roundtrip — we re-sort by the ANN rank below.
    candidatesQuery = candidatesQuery.in("id", annIds!);
  } else {
    // Legacy lexical pool — ordered by freshness, limited to candidatePool.
    candidatesQuery = candidatesQuery
      .order("synthesized_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(candidatePool);
    if (excludeIds.length > 0) {
      const idList = excludeIds.join(",");
      candidatesQuery = candidatesQuery.not("id", "in", `(${idList})`);
    }
  }

  const { data: poolData, error: poolErr } = await candidatesQuery;
  if (poolErr) {
    console.error("match-score pool query failed:", poolErr.message);
    return {
      rows: [],
      totalScored: 0,
      totalPool: 0,
      archetypePoolSize: poolSize.investor,
      firstConflict: null,
      detectedSignals: signals,
      suggestedArchetype: suggested,
    };
  }
  let candidates = (poolData ?? []) as unknown as CandidateRow[];

  // When hybrid retrieval is active, preserve ANN rank by sorting the
  // fetched rows against the original annIds order — PostgREST's .in()
  // doesn't honour input order.
  if (usingHybrid && annIds) {
    const rankById = new Map(annIds.map((id, i) => [id, i]));
    candidates = [...candidates].sort(
      (a, b) =>
        (rankById.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (rankById.get(b.id) ?? Number.POSITIVE_INFINITY),
    );
  }

  if (embedInfo && usingHybrid) {
    console.log(
      `[match-score] hybrid pool=${candidates.length} embed=${embedInfo.dims}d ${embedInfo.latencyMs}ms`,
    );
  } else if (embedInfo) {
    console.log(
      `[match-score] lexical pool=${candidates.length} (embed succeeded but ANN returned 0 ids)`,
    );
  }

  // Step 2b: load manual email overrides for any partner in the pool.
  // Overrides are user-provided addresses (migration 013). They bump the
  // effective tier so the "0 verified emails · cannot advance" chip
  // clears as soon as the user saves one from the Resolve-email modal.
  const allPartnerIds = new Set<number>();
  for (const inv of candidates) {
    for (const p of inv.partners_mirror ?? []) allPartnerIds.add(p.id);
  }
  const overrideTierByPartner = new Map<number, string>();
  if (allPartnerIds.size > 0) {
    // RLS scopes this to the current user's overrides automatically,
    // so we skip the .in() filter — an IN list with thousands of ids
    // blows the PostgREST URL length limit (27kB 400 bad request).
    // Per-user override counts are expected to be small.
    const { data: overrides, error: ovErr } = await supabase
      .from("partner_email_overrides")
      .select("partner_id, email_tier");
    if (ovErr) {
      console.error(
        "[match-score] partner_email_overrides query failed:",
        ovErr.message,
      );
    }
    for (const row of (overrides ?? []) as Array<{
      partner_id: number;
      email_tier: string;
    }>) {
      if (allPartnerIds.has(row.partner_id)) {
        overrideTierByPartner.set(row.partner_id, row.email_tier);
      }
    }
  }
  const effectiveTier = (partnerId: number, mirrorTier: string | null) =>
    overrideTierByPartner.get(partnerId) ?? mirrorTier ?? null;

  // Step 3: compute signals from heroText and score every candidate.
  const heroTokens = tokenise(heroText);
  const wantedStages = detectStages(heroText);
  const wantedGeos = detectGeos(heroText);
  const heroCheque = parseChequeRangeFromText(heroText);

  const scored: MatchResultRow[] = [];
  for (const inv of candidates) {
    const partners = inv.partners_mirror ?? [];
    const primary =
      partners.find((p) => p.is_primary_contact === true) ?? partners[0] ?? null;
    // Sendable bucket — anything that can advance to +2 Drafted. Updated
    // 2026-04-23 to include the NeverBounce sendable variants; matches
    // the taxonomy in `lib/queries/tracker.ts`.
    const verifiedCount = partners.filter((p) => {
      const tier = effectiveTier(p.id, p.email_tier);
      return (
        tier === "corresponded" ||
        tier === "hunter_verified" ||
        tier === "neverbounce_valid" ||
        tier === "neverbounce_catchall"
      );
    }).length;

    const dims = scoreDims(
      {
        thesis_summary: inv.thesis_summary,
        stage_focus: inv.stage_focus,
        geo_focus: inv.geo_focus,
        cheque_min_usd: inv.cheque_min_usd,
        cheque_max_usd: inv.cheque_max_usd,
        synthesized_at: inv.synthesized_at,
        last_enriched: inv.last_enriched,
        chrome_verified: inv.chrome_verified,
        hq_location: inv.hq_location,
        sector_focus: inv.sector_focus,
      },
      heroTokens,
      heroText,
      wantedStages,
      wantedGeos,
      heroCheque,
    );
    const match = dimAverage(dims);
    if (match < minMatch) continue;

    const nm = pickNearMiss(
      {
        dims,
        firm_name: inv.firm_name,
        stage_focus: inv.stage_focus,
        geo_focus: inv.geo_focus,
        sector_focus: inv.sector_focus,
        thesis_summary: inv.thesis_summary,
        cheque_min_raw: inv.cheque_min_usd,
        cheque_max_raw: inv.cheque_max_usd,
      },
      heroTokens,
      wantedStages,
    );

    const other = otherByInvestor.get(inv.id) ?? null;
    const current = currentByInvestor.get(inv.id) ?? null;

    scored.push({
      investor_id: inv.id,
      firm_name: inv.firm_name,
      hq_location: inv.hq_location,
      sector_focus: inv.sector_focus,
      stage_focus: inv.stage_focus,
      geo_focus: inv.geo_focus,
      cheque_min_raw: inv.cheque_min_usd,
      cheque_max_raw: inv.cheque_max_usd,
      fund_size_raw: inv.fund_size_usd,
      thesis_summary: inv.thesis_summary,
      thesis_deep: inv.thesis_deep,
      ideal_company_profile: inv.ideal_company_profile,
      dims,
      match,
      primary_partner: primary
        ? {
            id: primary.id,
            name: primary.name,
            title: primary.title,
            email_tier: (effectiveTier(primary.id, primary.email_tier) ??
              null) as EmailTier,
          }
        : null,
      partner_count: partners.length,
      verified_email_count: verifiedCount,
      last_contact_days: current?.days ?? null,
      on_current_campaign: current,
      on_other_campaign: other ? { ...other, firm_name: inv.firm_name ?? "This firm" } : null,
      near_miss: nm,
      why_them: deriveWhyThem(inv),
      // Attached in a follow-up pass below — keep the in-loop allocation
      // to a stable empty array so the row already conforms to the type.
      portfolio_fit: [],
    });
  }

  // Batch-fetch portfolio fit for every scored investor. One round-trip
  // pulls every link row across the whole result set; we then bucket
  // and attach top-3 per investor in JS. This is cheaper than N queries
  // and keeps the surface honest — when no portfolio rows exist the
  // attached array stays empty and the UI renders nothing.
  await attachPortfolioFit(supabase, scored);

  // Step 4: tab-based filter + sort
  let ranked = scored;
  if (tab === "thesis") {
    ranked = [...scored].sort((a, b) => b.dims.thesis - a.dims.thesis);
  } else if (tab === "near_miss") {
    ranked = scored.filter((r) => r.near_miss !== null);
    ranked.sort((a, b) => b.match - a.match);
  } else {
    ranked = [...scored].sort((a, b) => b.match - a.match);
  }

  const rows = ranked.slice(0, limit);

  // Resolve first conflict for the banner. V4 (line 966) shows a conflict
  // whenever ANY firm present in this result set OR scored-but-not-visible
  // is active in another campaign within 14 days. We widen the scan to
  // cover all scored rows, not just the top-N, so the banner can warn the
  // operator about a collision they might not otherwise see. If none of
  // the scored rows collide, no banner renders.
  let firstConflict: ConflictRow | null = null;
  for (const r of ranked) {
    if (r.on_other_campaign) {
      firstConflict = r.on_other_campaign;
      break;
    }
  }

  return {
    rows,
    totalScored: scored.length,
    totalPool: candidates.length,
    archetypePoolSize: poolSize.investor,
    firstConflict,
    detectedSignals: signals,
    suggestedArchetype: suggested,
  };
}

/* ------------------------------------------------------------------------- */
/* Portfolio-fit attachment                                                  */
/* ------------------------------------------------------------------------- */

/**
 * For every scored investor, attach the top-3 portfolio companies that
 * best represent the firm's actual investing pattern. The signal we use
 * is round recency (most recent rounds first) joined to the dossier-style
 * `portfolio_company_profiles` table for the "what they do" line — when
 * a profile is missing, the company still surfaces with `what_they_do = null`.
 *
 * One round-trip pulls every `investor_portfolio_links` row across the
 * full investor set, plus the canonical name/slug from `portfolio_companies`.
 * A second round-trip pulls the dossier rows in one shot keyed by
 * company name. Both are bounded by the size of the scored set
 * (typically <= 25 investors × <= 100 rounds each).
 *
 * This is intentionally simple — no embedding-driven sector match yet.
 * "Top-3 by recency" is the V1 take; the embedding-similarity rank lands
 * once the compose-side embedding pipeline is wired through.
 */
async function attachPortfolioFit(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  rows: MatchResultRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const investorIds = rows.map((r) => r.investor_id);

  const { data: linkRows, error: linkErr } = await supabase
    .from("investor_portfolio_links")
    .select(
      `investor_id, portfolio_company_id, round, round_at,
       portfolio_companies:portfolio_company_id ( slug, name, sector )`,
    )
    .in("investor_id", investorIds)
    .order("round_at", { ascending: false, nullsFirst: false })
    .limit(2000);

  if (linkErr) {
    console.warn(
      "[match-score] portfolio-fit links query failed:",
      linkErr.message,
    );
    return;
  }

  interface LinkRow {
    investor_id: number;
    portfolio_company_id: number;
    round: string | null;
    round_at: string | null;
    portfolio_companies: {
      slug: string;
      name: string;
      sector: string | null;
    } | null;
  }

  // Bucket per investor, stop after 3 visible companies. Round-recency
  // ordering means the first 3 we see are the picks.
  const byInvestor = new Map<number, Array<{ slug: string; name: string; sector: string | null }>>();
  for (const raw of (linkRows ?? []) as unknown as LinkRow[]) {
    const pc = raw.portfolio_companies;
    if (!pc) continue;
    const bucket = byInvestor.get(raw.investor_id) ?? [];
    if (bucket.length >= 3) continue;
    if (bucket.some((b) => b.slug === pc.slug)) continue;
    bucket.push({ slug: pc.slug, name: pc.name, sector: pc.sector });
    byInvestor.set(raw.investor_id, bucket);
  }

  // Collect distinct names so we can pull dossier prose in one round-trip.
  const distinctNames = new Set<string>();
  for (const bucket of byInvestor.values()) {
    for (const c of bucket) distinctNames.add(c.name);
  }

  const dossierByName = new Map<string, { sector: string | null; what_they_do: string | null }>();
  if (distinctNames.size > 0) {
    const { data: dossierRows, error: dossierErr } = await supabase
      .from("portfolio_company_profiles")
      .select("company_name, sector, what_they_do")
      .in("company_name", Array.from(distinctNames));
    if (dossierErr) {
      console.warn(
        "[match-score] portfolio-fit dossier query failed:",
        dossierErr.message,
      );
    } else {
      for (const r of (dossierRows ?? []) as Array<{
        company_name: string;
        sector: string | null;
        what_they_do: string | null;
      }>) {
        dossierByName.set(r.company_name, {
          sector: r.sector,
          what_they_do: r.what_they_do,
        });
      }
    }
  }

  for (const row of rows) {
    const bucket = byInvestor.get(row.investor_id) ?? [];
    row.portfolio_fit = bucket.map((c) => {
      const dossier = dossierByName.get(c.name);
      return {
        slug: c.slug,
        name: c.name,
        // Prefer the dossier sector (more specific) over the canonical
        // table's sector field. Null when neither exists.
        sector: dossier?.sector ?? c.sector ?? null,
        what_they_do: dossier?.what_they_do ?? null,
      };
    });
  }
}
