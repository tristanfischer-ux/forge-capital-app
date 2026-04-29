"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";
import {
  getMatchScore,
  type GetMatchScoreResult,
  type Archetype,
} from "@/lib/queries/match-score";
import {
  getLookalikeMatches,
  type LookalikeResult,
} from "@/lib/queries/lookalikes";

/**
 * Server actions for the V4 §3 Find-a-Match surface. Distinct from the
 * V1 `actions.ts` (which still powers the shortlistTopN flow) — these
 * actions back the richer "score + surface conflict" UI.
 *
 * Two entry points:
 *  - `findMatches` — runs the scoring query for a given hero text + archetype.
 *  - `shortlistSelected` — given a list of investor_ids picked via the
 *    batch-bar checkboxes, insert +0 Pending approval rows. Small wrapper
 *    around the same shortlistOne helper used by the V1 action.
 */

export type FindMatchesResult =
  | { ok: true; data: GetMatchScoreResult }
  | { ok: false; error: string };

export async function findMatches(input: {
  heroText: string;
  archetype: Archetype;
  campaignId: string;
  limit?: number;
  tab?: "best" | "thesis" | "near_miss";
  minMatch?: number;
  hideContacted?: boolean;
}): Promise<FindMatchesResult> {
  const {
    heroText,
    archetype,
    campaignId,
    limit = 25,
    tab = "best",
    minMatch = 0,
    hideContacted = true,
  } = input;

  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  try {
    const data = await getMatchScore({
      heroText,
      archetype,
      campaignId,
      limit,
      tab,
      minMatch,
      hideContacted,
    });
    return { ok: true, data };
  } catch (err) {
    console.error("findMatches failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown match-score error",
    };
  }
}

/* ------------------------------------------------------------------------- */

export type FindLookalikesResult =
  | { ok: true; data: LookalikeResult }
  | { ok: false; error: string };

/**
 * Lookalike matching — find investors similar to the ones who
 * already replied positively on this campaign. Distinct from
 * `findMatches` above: that one scores against the user's hero
 * text; this one scores against the respondent anchors.
 */
export async function findLookalikes(input: {
  campaignId: string;
  limit?: number;
}): Promise<FindLookalikesResult> {
  const { campaignId, limit = 10 } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  try {
    const data = await getLookalikeMatches(campaignId, limit);
    return { ok: true, data };
  } catch (err) {
    console.error("findLookalikes failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown lookalike error",
    };
  }
}

/* ------------------------------------------------------------------------- */

export type ShortlistSelectedResult =
  | {
      ok: true;
      shortlisted: Array<{ investor_id: number; name: string }>;
      skipped: Array<{ investor_id: number; name: string; reason: string }>;
    }
  | { ok: false; error: string };

/**
 * Shortlist a set of investor_ids at +0 Pending approval on the given
 * campaign. Used by the batch-bar "Shortlist to approval sheet →"
 * button in the V4 §3 UI.
 */
export async function shortlistSelected(input: {
  campaignId: string;
  investorIds: number[];
}): Promise<ShortlistSelectedResult> {
  const { campaignId, investorIds } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };
  if (!Array.isArray(investorIds) || investorIds.length === 0) {
    return { ok: false, error: "no investors selected" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const shortlisted: Array<{ investor_id: number; name: string }> = [];
  const skipped: Array<{ investor_id: number; name: string; reason: string }> = [];

  for (const investorId of investorIds) {
    // Resolve firm + preferred partner.
    const { data: investor, error: invErr } = await supabase
      .from("investors_mirror")
      .select(
        `
        firm_name,
        partners_mirror:partners_mirror!partners_mirror_investor_id_fkey (
          id, is_primary_contact
        )
        `,
      )
      .eq("id", investorId)
      .maybeSingle();

    if (invErr || !investor) {
      skipped.push({
        investor_id: investorId,
        name: `Investor ${investorId}`,
        reason: invErr?.message ?? "Investor not found",
      });
      continue;
    }

    const firmName = (investor as { firm_name: string | null }).firm_name ?? `Investor ${investorId}`;
    const partners = ((investor as { partners_mirror: Array<{ id: number; is_primary_contact: boolean | null }> })
      .partners_mirror ?? []);
    if (partners.length === 0) {
      skipped.push({
        investor_id: investorId,
        name: firmName,
        reason: "No partner on file — sync a contact before shortlisting",
      });
      continue;
    }
    const partnerId =
      partners.find((p) => p.is_primary_contact === true)?.id ?? partners[0].id;

    const { error: insertErr } = await supabase
      .from("campaign_partners")
      .insert({
        campaign_id: campaignId,
        partner_id: partnerId,
        status_code: "+0",
        status_label: labelFor("+0"),
      })
      .select("id")
      .single();

    if (insertErr) {
      const alreadyExists = /duplicate key|unique/i.test(insertErr.message);
      skipped.push({
        investor_id: investorId,
        name: firmName,
        reason: alreadyExists ? "Already on this campaign" : insertErr.message,
      });
    } else {
      shortlisted.push({ investor_id: investorId, name: firmName });
    }
  }

  revalidatePath("/match");
  revalidatePath("/tracker");
  return { ok: true, shortlisted, skipped };
}

/* ------------------------------------------------------------------------- */
/* On-demand investor insight — "Why they might back you" + "How to pitch"  */
/* ------------------------------------------------------------------------- */

export interface InvestorInsight {
  why_might_back: string;
  how_to_pitch: string;
}

export type GenerateInsightResult =
  | { ok: true; insight: InvestorInsight }
  | { ok: false; error: string };

export async function generateInsight(input: {
  heroText: string;
  firmName: string;
  thesisDeep: string | null;
  idealCompanyProfile: string | null;
  sectorFocus: string | null;
  stageFocus: string | null;
  geoFocus: string | null;
  investmentPattern: string | null;
  portfolioNames: string[];
}): Promise<GenerateInsightResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OpenRouter key not configured" };

  const investorContext = [
    input.thesisDeep ? `Thesis: ${input.thesisDeep}` : null,
    input.idealCompanyProfile
      ? `Ideal company profile: ${input.idealCompanyProfile}`
      : null,
    input.sectorFocus ? `Sector focus: ${input.sectorFocus}` : null,
    input.stageFocus ? `Stage focus: ${input.stageFocus}` : null,
    input.geoFocus ? `Geography focus: ${input.geoFocus}` : null,
    input.investmentPattern
      ? `Investment pattern: ${input.investmentPattern}`
      : null,
    input.portfolioNames.length > 0
      ? `Portfolio companies: ${input.portfolioNames.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are an investor outreach adviser for a hardware startup founder. Given the founder's pitch and an investor's profile, produce two sections.

FOUNDER'S PITCH:
${input.heroText}

INVESTOR — ${input.firmName}:
${investorContext || "Limited data on file."}

Respond in EXACTLY this format (no markdown headers, no bullet points, just flowing paragraphs):

WHY THEY MIGHT BACK YOU:
[One paragraph, 80-150 words. Explain why this investor's thesis, portfolio, and sector focus align with the founder's company. Reference specific portfolio companies or stated focus areas. Be concrete — no generic "they invest in your space" filler. If the fit is weak, say so honestly and explain the angle that could work.]

HOW TO PITCH:
[One paragraph, 80-150 words. Give specific tactical advice on how to frame the pitch for this investor. Reference their stated thesis language, what they look for, and how the founder should position their company. Include what to lead with and what to emphasise.]`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://forge-capital-app.vercel.app",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[generateInsight] OpenRouter ${res.status}: ${body.slice(0, 200)}`,
      );
      return { ok: false, error: `OpenRouter returned ${res.status}` };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.message?.reasoning_content ||
      "";

    if (!content) {
      return { ok: false, error: "Empty response from model" };
    }

    const whyMatch = content.match(
      /WHY THEY MIGHT BACK YOU:\s*\n?([\s\S]*?)(?=\n\s*HOW TO PITCH:|$)/i,
    );
    const howMatch = content.match(/HOW TO PITCH:\s*\n?([\s\S]*?)$/i);

    return {
      ok: true,
      insight: {
        why_might_back: whyMatch?.[1]?.trim() || content.trim(),
        how_to_pitch: howMatch?.[1]?.trim() || "",
      },
    };
  } catch (err) {
    console.error("[generateInsight] failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Insight generation failed",
    };
  }
}

/* ------------------------------------------------------------------------- */
/* Chunk evidence — relevant scraped website excerpts for one investor       */
/* ------------------------------------------------------------------------- */

export interface ChunkEvidence {
  chunk_text: string;
  page_url: string;
  chunk_index: number;
  cosine_similarity: number;
}

export type GetChunkEvidenceResult =
  | { ok: true; chunks: ChunkEvidence[]; indexing?: boolean }
  | { ok: false; error: string };

export async function getChunkEvidence(input: {
  investorId: number;
  heroText: string;
  limit?: number;
}): Promise<GetChunkEvidenceResult> {
  const { investorId, heroText, limit = 10 } = input;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { embedQueryText } = await import("@/lib/embeddings/openai");
  const embedResult = await embedQueryText(heroText);
  if (!embedResult.ok) {
    return { ok: false, error: "Could not embed hero text" };
  }

  const { data, error } = await supabase.rpc("match_chunks_for_investor", {
    p_investor_id: investorId,
    query_embedding: embedResult.vector,
    match_count: limit,
    min_similarity: 0.0,
  });

  if (error) {
    console.error("[getChunkEvidence] RPC failed:", error.message);
    return { ok: false, error: error.message };
  }

  const chunks = ((data ?? []) as Array<{
    chunk_text: string;
    page_url: string;
    chunk_index: number;
    cosine_similarity: number;
  }>).map((r) => ({
    chunk_text: r.chunk_text,
    page_url: r.page_url,
    chunk_index: r.chunk_index,
    cosine_similarity: r.cosine_similarity,
  }));

  if (chunks.length === 0) {
    const { count } = await supabase
      .from("investor_page_chunks")
      .select("id", { count: "exact", head: true })
      .eq("investor_id", investorId);
    if (count === 0) {
      return { ok: true, chunks: [], indexing: true };
    }
  }

  return { ok: true, chunks };
}
