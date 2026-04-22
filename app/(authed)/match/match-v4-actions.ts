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
