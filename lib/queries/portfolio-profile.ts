import { createServerClient } from "@/lib/supabase/server";

/**
 * Profile-page data loader for /portfolio/[slug] — reads one canonical
 * `portfolio_companies` row by slug, plus every investor backing it
 * (joined via `investor_portfolio_links` → `investors_mirror`), plus a
 * partner-count and primary-partner snippet per investor for quick
 * context on the card list.
 *
 * Shape mirrors the convention of `investor-profile.ts` and
 * `partner-profile.ts`: a single `getPortfolioCompany(slug)` function
 * returns either a fully-populated object or `null` (the page's
 * `notFound()` path).
 *
 * RLS-scoped: founders see every link; approvers only see links on
 * investors they can already see via investors_mirror. The query joins
 * to investors_mirror and the response will naturally narrow for
 * approvers — no extra filter needed in this layer.
 */

export interface PortfolioInvestorBacker {
  investor_id: number;
  firm_name: string | null;
  type: string | null;
  hq_location: string | null;
  round: string | null;
  round_at: string | null;
  amount_raw: string | null;
  source_url: string | null;
  partners_count: number;
  primary_partner_name: string | null;
  primary_partner_title: string | null;
}

export interface PortfolioProfileData {
  id: number;
  slug: string;
  name: string;
  sector: string | null;
  stage: string | null;
  hq_location: string | null;
  website: string | null;
  last_synced_at: string | null;
  backers: PortfolioInvestorBacker[];
}

export async function getPortfolioCompany(
  slug: string,
): Promise<PortfolioProfileData | null> {
  const normalised = typeof slug === "string" ? slug.trim() : "";
  if (!normalised) return null;
  const supabase = await createServerClient();

  // ── Company row ──
  const { data: companyRow, error: companyErr } = await supabase
    .from("portfolio_companies")
    .select("id, slug, name, sector, stage, hq_location, website, last_synced_at")
    .eq("slug", normalised)
    .maybeSingle();

  if (companyErr) {
    console.error("getPortfolioCompany company fetch failed:", companyErr.message);
    return null;
  }
  if (!companyRow) return null;

  const company = companyRow as unknown as {
    id: number;
    slug: string;
    name: string;
    sector: string | null;
    stage: string | null;
    hq_location: string | null;
    website: string | null;
    last_synced_at: string | null;
  };

  // ── Junction rows + investors_mirror ──
  const { data: linkRows, error: linkErr } = await supabase
    .from("investor_portfolio_links")
    .select(
      `investor_id, round, round_at, amount_raw, source_url,
       investors_mirror:investor_id ( id, firm_name, type, hq_location )`,
    )
    .eq("portfolio_company_id", company.id);

  if (linkErr) {
    console.error("getPortfolioCompany links fetch failed:", linkErr.message);
  }

  const links = (linkRows ?? []) as unknown as Array<{
    investor_id: number;
    round: string | null;
    round_at: string | null;
    amount_raw: string | null;
    source_url: string | null;
    investors_mirror: {
      id: number;
      firm_name: string | null;
      type: string | null;
      hq_location: string | null;
    } | null;
  }>;

  // Drop junctions whose investor row is RLS-hidden (approver's scoped
  // view) — the embed returns null for those.
  const visible = links.filter((l) => l.investors_mirror != null);
  const investorIds = visible.map((l) => l.investor_id);

  // ── Partner stats (count + primary) ──
  // One query to get every partner row across the visible investors; we
  // roll it up in JS because PostgREST can't do COUNT-with-preferred-row
  // in a single call without a view.
  const partnerCountById = new Map<number, number>();
  const primaryByInvestor = new Map<
    number,
    { name: string | null; title: string | null }
  >();
  if (investorIds.length > 0) {
    const { data: partnerRows, error: partnerErr } = await supabase
      .from("partners_mirror")
      .select("investor_id, name, title, is_primary_contact")
      .in("investor_id", investorIds);
    if (partnerErr) {
      console.error(
        "getPortfolioCompany partners fetch failed:",
        partnerErr.message,
      );
    } else {
      const rows = (partnerRows ?? []) as unknown as Array<{
        investor_id: number;
        name: string | null;
        title: string | null;
        is_primary_contact: boolean | null;
      }>;
      for (const row of rows) {
        partnerCountById.set(
          row.investor_id,
          (partnerCountById.get(row.investor_id) ?? 0) + 1,
        );
        // Prefer the is_primary_contact row; otherwise first-seen.
        const existing = primaryByInvestor.get(row.investor_id);
        if (!existing || row.is_primary_contact) {
          primaryByInvestor.set(row.investor_id, {
            name: row.name ?? null,
            title: row.title ?? null,
          });
        }
      }
    }
  }

  const backers: PortfolioInvestorBacker[] = visible
    .map((l) => ({
      investor_id: l.investor_id,
      firm_name: l.investors_mirror?.firm_name ?? null,
      type: l.investors_mirror?.type ?? null,
      hq_location: l.investors_mirror?.hq_location ?? null,
      round: l.round,
      round_at: l.round_at,
      amount_raw: l.amount_raw,
      source_url: l.source_url,
      partners_count: partnerCountById.get(l.investor_id) ?? 0,
      primary_partner_name:
        primaryByInvestor.get(l.investor_id)?.name ?? null,
      primary_partner_title:
        primaryByInvestor.get(l.investor_id)?.title ?? null,
    }))
    .sort((a, b) => {
      // Most partners first (likely the richer profile), then firm name.
      if (b.partners_count !== a.partners_count) {
        return b.partners_count - a.partners_count;
      }
      const an = (a.firm_name ?? "").toLowerCase();
      const bn = (b.firm_name ?? "").toLowerCase();
      return an.localeCompare(bn);
    });

  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    sector: company.sector,
    stage: company.stage,
    hq_location: company.hq_location,
    website: company.website,
    last_synced_at: company.last_synced_at,
    backers,
  };
}
