import { createServerClient } from "@/lib/supabase/server";
export {
  MIN_LOOKALIKE_ANCHORS,
  POSITIVE_STATUS_WEIGHT,
  type LookalikeAnchor,
  type LookalikeRow,
  type LookalikeResult,
} from "./lookalikes-types";
import {
  MIN_LOOKALIKE_ANCHORS,
  POSITIVE_STATUS_WEIGHT,
  type LookalikeAnchor,
  type LookalikeRow,
  type LookalikeResult,
} from "./lookalikes-types";

/**
 * Lookalike matching — "investors similar to the ones who already
 * replied positively to this campaign".
 *
 * The data path:
 *   1. Find every campaign_partners row for this campaign whose
 *      status_code is a POSITIVE signal (+6 Response received through
 *      +12 Committed). These are the "respondent anchors".
 *   2. For each anchor, look up the investor in investors_mirror via
 *      partners_mirror.
 *   3. Aggregate the anchors' thesis / sector / stage / geo into a
 *      weighted signature. Stronger signals (meeting held, NDA, term
 *      sheet) count more than a reply.
 *   4. Score the remaining pool by token-overlap against this
 *      signature. Return the top N with a reasoning string naming
 *      which specific anchors they overlap with.
 *
 * Why token overlap rather than cosine-embedding similarity: the
 * investors_mirror in apex-outreach doesn't carry embeddings yet (the
 * 1536-dim OpenAI vectors live in the local Forge-Capital SQLite).
 * Token overlap uses the same substrate the existing match scorer
 * uses, and it's MORE explainable — we can show *which* anchor each
 * lookalike matches, rather than a black-box 89%.
 *
 * Minimum signal threshold: 3 anchors. Below that, the union is too
 * narrow to project — one or two investors pretending to be a trend.
 * The caller checks `result.anchorCount < MIN_ANCHORS` and renders
 * the gated empty state.
 */

function tokenise(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  const stop = new Set([
    "the","a","an","and","or","but","of","to","in","on","for","with","by",
    "at","is","are","was","were","be","been","we","you","our","your","their",
    "they","this","that","these","those","it","its","from","as","has","have",
    "had","not","no","do","does","will","can","may","so","if","when","where",
    "why","how","who","what","than","then","also","just","more","most","some",
    "any","all","into","out","over","under","up","down","company","companies",
    "startup","startups","investor","investors","fund","funds","capital",
    "ventures","llc","inc","ltd",
  ]);
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9€£$\-\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stop.has(w)),
  );
}

function investorSignature(inv: {
  thesis_summary: string | null;
  thesis_deep: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  geo_focus: string | null;
}): Set<string> {
  const sig = new Set<string>();
  for (const field of [
    inv.thesis_summary,
    inv.thesis_deep,
    inv.sector_focus,
    inv.stage_focus,
    inv.geo_focus,
  ]) {
    for (const tok of tokenise(field)) sig.add(tok);
  }
  return sig;
}

/**
 * Score how well an investor matches ONE anchor, returning 0-1.
 * Jaccard over token signatures. We sum per-anchor scores (weighted
 * by status strength) rather than computing against the union, so
 * stronger anchors (e.g. a meeting-held vs a single reply) pull
 * harder.
 */
function scoreAgainstAnchor(
  candidate: Set<string>,
  anchor: Set<string>,
): number {
  if (candidate.size === 0 || anchor.size === 0) return 0;
  let inter = 0;
  for (const t of candidate) if (anchor.has(t)) inter++;
  const union = candidate.size + anchor.size - inter;
  return union === 0 ? 0 : inter / union;
}

export async function getLookalikeMatches(
  campaignId: string,
  limit = 10,
): Promise<LookalikeResult> {
  const supabase = await createServerClient();

  // 1. Pull positive-signal campaign_partners for this campaign + join
  //    out to investor_id + firm_name.
  const { data: anchorRows, error: anchorErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      status_code, status_label,
      partners_mirror:partner_id (
        id,
        investor_id,
        investors_mirror:investor_id (
          id, firm_name, thesis_summary, thesis_deep,
          sector_focus, stage_focus, geo_focus
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .in("status_code", Object.keys(POSITIVE_STATUS_WEIGHT));

  if (anchorErr) {
    console.error("lookalikes: anchor query failed:", anchorErr.message);
    return { anchorCount: 0, anchors: [], rows: [], totalScored: 0 };
  }

  interface AnchorInvestor {
    id: number;
    firm_name: string;
    thesis_summary: string | null;
    thesis_deep: string | null;
    sector_focus: string | null;
    stage_focus: string | null;
    geo_focus: string | null;
  }

  const anchors: Array<LookalikeAnchor & { sig: Set<string>; inv: AnchorInvestor }> = [];
  for (const row of (anchorRows ?? []) as unknown as Array<{
    status_code: string;
    status_label: string | null;
    partners_mirror: {
      investors_mirror: AnchorInvestor | null;
    } | null;
  }>) {
    const inv = row.partners_mirror?.investors_mirror;
    if (!inv || typeof inv.id !== "number" || !inv.firm_name) continue;
    // De-dupe: the same investor might have multiple partners, all
    // advanced to positive status. Keep the strongest.
    const existing = anchors.findIndex((a) => a.investor_id === inv.id);
    const weight = POSITIVE_STATUS_WEIGHT[row.status_code] ?? 1;
    if (existing >= 0) {
      if (weight > anchors[existing].weight) {
        anchors[existing].weight = weight;
        anchors[existing].status_code = row.status_code;
        anchors[existing].status_label = row.status_label;
      }
      continue;
    }
    anchors.push({
      investor_id: inv.id,
      firm_name: inv.firm_name,
      status_code: row.status_code,
      status_label: row.status_label,
      weight,
      sig: investorSignature(inv),
      inv,
    });
  }

  if (anchors.length < MIN_LOOKALIKE_ANCHORS) {
    return {
      anchorCount: anchors.length,
      anchors: anchors.map(({ sig: _sig, inv: _inv, ...rest }) => {
        void _sig; void _inv;
        return rest;
      }),
      rows: [],
      totalScored: 0,
    };
  }

  // 2. Pull the candidate pool — actively_deploying investors who are
  //    NOT already an anchor and NOT already contacted on this campaign.
  //    V1: load up to 2,000 actively deploying, score them in Node. That's
  //    well within the reply budget for this page.
  const anchorIds = new Set(anchors.map((a) => a.investor_id));

  // Investors already on this campaign (via campaign_partners), regardless
  // of status — we don't want to "discover" someone we already track.
  const { data: alreadyOnCampaign } = await supabase
    .from("campaign_partners")
    .select("partners_mirror:partner_id(investor_id)")
    .eq("campaign_id", campaignId);
  const alreadyIds = new Set<number>();
  for (const row of (alreadyOnCampaign ?? []) as unknown as Array<{
    partners_mirror: { investor_id: number } | null;
  }>) {
    const invId = row.partners_mirror?.investor_id;
    if (typeof invId === "number") alreadyIds.add(invId);
  }

  const { data: pool, error: poolErr } = await supabase
    .from("investors_mirror")
    .select(
      "id, firm_name, hq_location, thesis_summary, thesis_deep, sector_focus, stage_focus, geo_focus",
    )
    .eq("actively_deploying", true)
    .limit(2000);

  if (poolErr || !pool) {
    console.error("lookalikes: pool query failed:", poolErr?.message);
    return {
      anchorCount: anchors.length,
      anchors: anchors.map(({ sig: _sig, inv: _inv, ...rest }) => {
        void _sig; void _inv;
        return rest;
      }),
      rows: [],
      totalScored: 0,
    };
  }

  // 3. Score each candidate against every anchor. Per-candidate score
  //    = sum over anchors of (jaccard * anchor.weight). Then normalise
  //    to 0-100 against the theoretical max (sum of weights * 1.0).
  const maxAnchorScore = anchors.reduce((sum, a) => sum + a.weight, 0);

  interface Scored {
    row: (typeof pool)[number];
    rawScore: number;
    contributions: Array<{ anchor: LookalikeAnchor; score: number }>;
  }

  const scored: Scored[] = [];
  for (const cand of pool) {
    if (alreadyIds.has(cand.id) || anchorIds.has(cand.id)) continue;
    const candSig = investorSignature(cand);
    if (candSig.size === 0) continue;

    let raw = 0;
    const contributions: Scored["contributions"] = [];
    for (const a of anchors) {
      const s = scoreAgainstAnchor(candSig, a.sig);
      if (s > 0) {
        contributions.push({ anchor: a, score: s });
        raw += s * a.weight;
      }
    }
    if (raw > 0) {
      scored.push({ row: cand, rawScore: raw, contributions });
    }
  }

  scored.sort((a, b) => b.rawScore - a.rawScore);

  const top = scored.slice(0, limit).map<LookalikeRow>((s) => {
    // Pick the 2 strongest anchor contributions for the reason string.
    const topAnchors = s.contributions
      .sort((x, y) => y.score * y.anchor.weight - x.score * x.anchor.weight)
      .slice(0, 2)
      .map((c) => c.anchor);
    const matchScore = Math.min(
      100,
      Math.round((s.rawScore / Math.max(1, maxAnchorScore)) * 100),
    );
    const reason =
      topAnchors.length === 1
        ? `Shares thesis signal with ${topAnchors[0].firm_name} (${topAnchors[0].status_label ?? topAnchors[0].status_code}).`
        : `Shares thesis signal with ${topAnchors[0].firm_name} and ${topAnchors[1].firm_name}.`;

    return {
      investor_id: s.row.id,
      firm_name: s.row.firm_name,
      hq_location: s.row.hq_location,
      thesis_summary: s.row.thesis_summary,
      sector_focus: s.row.sector_focus,
      stage_focus: s.row.stage_focus,
      geo_focus: s.row.geo_focus,
      match_score: matchScore,
      matched_anchors: topAnchors.map((a) => a.firm_name),
      reason,
    };
  });

  return {
    anchorCount: anchors.length,
    anchors: anchors.map(({ sig: _sig, inv: _inv, ...rest }) => {
      void _sig; void _inv;
      return rest;
    }),
    rows: top,
    totalScored: scored.length,
  };
}
