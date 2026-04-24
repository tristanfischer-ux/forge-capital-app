import { createServerClient } from "@/lib/supabase/server";

/**
 * Customer partners on a campaign — the curated set that replaces
 * semantic match-scoring on customer-intent campaigns.
 *
 * Customer outreach doesn't flow through Find-a-Match's semantic
 * scoring (the pool is a named list, not a 50K-row corpus). Instead
 * we render the existing campaign_partners rows for the active
 * customer campaign as cards on the /match + /home Find-a-Match
 * panel, so Tristan can see his Wave 1 / 2 / 3 / Niche prospects
 * in the same visual rhythm as the investor pool.
 *
 * Each card carries enough to act on: firm, country, wave, pitch
 * hook, expected £ EBITDA, and the current contact.
 */

export interface CustomerCampaignPartnerCard {
  campaign_partner_id: string;
  customer_id: number;
  firm_name: string | null;
  website: string | null;
  country_iso: string | null;
  hq_location: string | null;
  type: string | null;
  wave: "1" | "2" | "3" | "niche" | null;
  pitch_hook: string | null;
  expected_ebitda_gbp: number | null;
  status_code: string | null;
  status_label: string | null;
  /** Current contact's name + title, if any — shown on the card. */
  partner_name: string | null;
  partner_title: string | null;
  /** Count of other contacts known at the same customer — UI badge so
   *  Tristan can spot firms with a lot of contact coverage vs firms
   *  that still need email-hunt enrichment. */
  contact_count: number;
}

/**
 * Load every campaign_partners row for a customer-intent campaign,
 * joined to customers_mirror + current contact. Ordered by wave
 * (1 → 2 → 3 → niche → unknown) then status_code (+0 queue first)
 * then firm_name alphabetical.
 */
export async function listCustomerCampaignPartners(
  campaignId: string,
): Promise<CustomerCampaignPartnerCard[]> {
  if (!campaignId) return [];
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id, status_code, status_label, created_at,
      partners_mirror:partner_id (
        id, name, title, kind, customer_id,
        customers_mirror:customer_id (
          id, firm_name, website, country_iso, hq_location, type, wave,
          pitch_hook, expected_ebitda_gbp
        )
      )
      `,
    )
    .eq("campaign_id", campaignId);

  if (error) {
    console.error("listCustomerCampaignPartners failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    status_code: string | null;
    status_label: string | null;
    created_at: string | null;
    partners_mirror: {
      id: number;
      name: string | null;
      title: string | null;
      kind: string | null;
      customer_id: number | null;
      customers_mirror: {
        id: number;
        firm_name: string | null;
        website: string | null;
        country_iso: string | null;
        hq_location: string | null;
        type: string | null;
        wave: string | null;
        pitch_hook: string | null;
        expected_ebitda_gbp: number | null;
      } | null;
    } | null;
  }>;

  // Filter to customer-kind rows only; count sibling contacts per
  // customer_id for the "N contacts" badge on each card.
  const customerIds = rows
    .filter((r) => r.partners_mirror?.kind === "customer")
    .map((r) => r.partners_mirror?.customer_id)
    .filter((id): id is number => !!id);

  let contactCountByCustomer = new Map<number, number>();
  if (customerIds.length > 0) {
    const { data: siblings } = await supabase
      .from("partners_mirror")
      .select("customer_id")
      .in("customer_id", customerIds);
    for (const row of (siblings ?? []) as Array<{ customer_id: number | null }>) {
      if (row.customer_id == null) continue;
      contactCountByCustomer.set(
        row.customer_id,
        (contactCountByCustomer.get(row.customer_id) ?? 0) + 1,
      );
    }
  }

  const cards: CustomerCampaignPartnerCard[] = rows
    .filter((r) => r.partners_mirror?.kind === "customer")
    .map((r) => {
      const partner = r.partners_mirror!;
      const customer = partner.customers_mirror!;
      const waveRaw = customer.wave;
      const wave: CustomerCampaignPartnerCard["wave"] =
        waveRaw === "1" || waveRaw === "2" || waveRaw === "3" || waveRaw === "niche"
          ? waveRaw
          : null;
      return {
        campaign_partner_id: r.id,
        customer_id: customer.id,
        firm_name: customer.firm_name,
        website: customer.website,
        country_iso: customer.country_iso,
        hq_location: customer.hq_location,
        type: customer.type,
        wave,
        pitch_hook: customer.pitch_hook,
        expected_ebitda_gbp: customer.expected_ebitda_gbp,
        status_code: r.status_code,
        status_label: r.status_label,
        partner_name: partner.name,
        partner_title: partner.title,
        contact_count: contactCountByCustomer.get(customer.id) ?? 0,
      };
    });

  // Sort: wave 1 → 2 → 3 → niche → null; then +0 pending → others;
  // then alphabetical firm_name.
  const waveRank = (w: CustomerCampaignPartnerCard["wave"]) =>
    w === "1" ? 1 : w === "2" ? 2 : w === "3" ? 3 : w === "niche" ? 4 : 5;
  const statusRank = (s: string | null) => (s === "+0" ? 0 : 1);
  cards.sort((a, b) => {
    const wd = waveRank(a.wave) - waveRank(b.wave);
    if (wd !== 0) return wd;
    const sd = statusRank(a.status_code) - statusRank(b.status_code);
    if (sd !== 0) return sd;
    return (a.firm_name ?? "").localeCompare(b.firm_name ?? "");
  });

  return cards;
}
