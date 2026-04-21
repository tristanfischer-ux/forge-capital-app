"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { labelFor } from "@/lib/status-codes";
import {
  getMatchRows,
  type MatchFilters,
  type MatchSortKey,
  type MatchSortDir,
} from "@/lib/queries/match";

/**
 * Match-list server actions. Two entry points:
 *
 *   - `shortlistInvestor` — adds one firm to the current campaign.
 *     Inserts a single `campaign_partners` row at +0 Pending approval.
 *
 *   - `shortlistTopN`     — runs the current match query, takes top N,
 *     calls `shortlistInvestor` per row, returns a summary of which
 *     firms landed and which were skipped + why.
 *
 * Both require an authenticated session — RLS on campaign_partners
 * already blocks unauth writes, but we surface a friendly error in
 * the UI rather than relying on a postgres error.
 */

export type ShortlistOutcome =
  | { ok: true; shortlisted: Array<{ name: string }>; skipped: Array<{ name: string; reason: string }> }
  | { ok: false; error: string };

export async function shortlistInvestor(input: {
  campaignId: string;
  investorId: number;
}): Promise<ShortlistOutcome> {
  const { campaignId, investorId } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };
  if (!Number.isFinite(investorId)) {
    return { ok: false, error: "investorId required" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const outcome = await shortlistOne(supabase, campaignId, investorId);
  revalidatePath("/match");
  revalidatePath("/tracker");
  if (outcome.ok) {
    return {
      ok: true,
      shortlisted: [{ name: outcome.firmName }],
      skipped: [],
    };
  }
  return {
    ok: true,
    shortlisted: [],
    skipped: [{ name: outcome.firmName ?? `Investor ${investorId}`, reason: outcome.reason }],
  };
}

export async function shortlistTopN(input: {
  campaignId: string;
  filters: MatchFilters;
  includeExisting: boolean;
  sortKey: MatchSortKey;
  sortDir: MatchSortDir;
  n: number;
}): Promise<ShortlistOutcome> {
  const { campaignId, filters, includeExisting, sortKey, sortDir } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };
  // Clamp N to a safe range — matches the UI's min=1 max=100 input.
  const n = Math.max(1, Math.min(100, Math.floor(input.n)));

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Fetch the current top-N against the user's filters. Dedupe is ON by
  // default (`includeExisting=false`) so we don't try to re-shortlist
  // firms already on the campaign — saves a round-trip per row.
  const { rows } = await getMatchRows({
    campaignId,
    filters,
    includeExisting,
    sortKey,
    sortDir,
    pageSize: n,
    page: 0,
  });

  const shortlisted: Array<{ name: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  // Sequential, not concurrent — these are cheap inserts and we want
  // deterministic ordering in the confirmation toast.
  for (const row of rows) {
    const outcome = await shortlistOne(supabase, campaignId, row.investor_id);
    const name = outcome.firmName ?? row.firm_name ?? `Investor ${row.investor_id}`;
    if (outcome.ok) {
      shortlisted.push({ name });
    } else {
      skipped.push({ name, reason: outcome.reason });
    }
  }

  revalidatePath("/match");
  revalidatePath("/tracker");
  return { ok: true, shortlisted, skipped };
}

/**
 * Core one-shot shortlist. Resolves the partner to attach
 * (primary contact preferred, otherwise any partner on the firm) and
 * inserts a single `campaign_partners` row at +0 Pending approval.
 *
 * Returns a discriminated result so the caller can compose a
 * per-row summary. Never throws — caller handles both branches.
 */
type ShortlistOneResult =
  | { ok: true; firmName: string; campaignPartnerId: string }
  | { ok: false; firmName: string | null; reason: string };

async function shortlistOne(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  campaignId: string,
  investorId: number,
): Promise<ShortlistOneResult> {
  // Look up the firm name + all partners on the investor. We prefer the
  // primary contact, falling back to any partner row. If none exist we
  // cannot insert a campaign_partners row (partner_id is NOT NULL) —
  // report the skip explicitly so the UI can surface it.
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
    return {
      ok: false,
      firmName: null,
      reason: invErr?.message ?? "Investor not found",
    };
  }

  const firmName = (investor as { firm_name: string | null }).firm_name ?? `Investor ${investorId}`;
  const partners = ((investor as { partners_mirror: Array<{ id: number; is_primary_contact: boolean | null }> })
    .partners_mirror ?? []);

  if (partners.length === 0) {
    return {
      ok: false,
      firmName,
      reason: "No partner on file — sync a contact before shortlisting",
    };
  }

  const partnerId =
    partners.find((p) => p.is_primary_contact === true)?.id ?? partners[0].id;

  // Insert at +0 Pending approval. Status label derives from the legend
  // so the two columns never drift. Unique-constraint on
  // (campaign_id, partner_id) protects against double-shortlisting —
  // the error bubbles up cleanly as a skip.
  const { data: inserted, error: insertErr } = await supabase
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
    // Unique violation = already on the campaign. Treat as a skip, not
    // a hard failure. Postgres code 23505 surfaces as part of message.
    const alreadyExists = /duplicate key|unique/i.test(insertErr.message);
    return {
      ok: false,
      firmName,
      reason: alreadyExists ? "Already on this campaign" : insertErr.message,
    };
  }

  return { ok: true, firmName, campaignPartnerId: (inserted as { id: string }).id };
}
