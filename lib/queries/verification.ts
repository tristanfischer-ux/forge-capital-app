import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier } from "@/lib/queries/tracker";

/**
 * Per-tier partner references the verification gate buttons need to
 * operate on. We expose both the `campaign_partners.id` (uuid — what
 * `markPartnerInactive` writes against) and the underlying
 * `partners_mirror.id` (bigint — what `queueHunterLookup` and the
 * EmailHuntModal's `fc:resolve-email` event expect) so each button can
 * pick the right identifier without a second round-trip.
 *
 * `firstInvestorIdByTier` gives the buttons a single investor to anchor
 * the EmailHuntModal on — the modal opens per-firm. We surface the
 * investor for the first unverified partner so "Resolve email" opens
 * straight into a resolvable firm; if nothing is unverified the entry
 * is absent.
 */
export interface VerificationTierRefs {
  /** `campaign_partners.id` (uuid) for every row in this tier. */
  campaignPartnerIds: string[];
  /** `partners_mirror.id` (bigint) for every row in this tier. */
  partnerIds: number[];
  /** First investor-id for a partner in this tier; used to open the
   *  EmailHuntModal on a concrete firm. null when tier has no rows. */
  firstInvestorId: number | null;
}

/**
 * One row per deliverability tier, sized by the count of partners in the
 * active campaign whose `partners_mirror.email_tier` equals that tier.
 *
 * The tier taxonomy is fixed at 5 values (see `003_partners_mirror.sql`).
 * A sixth logical bucket — partners with NULL `email_tier` — is folded
 * into `unverified` at the query layer so the UI keeps one ladder row
 * per tier. The ladder renders every tier even when count is zero, so
 * the shape of the gate is visible before any data arrives.
 */
export type VerificationTier = Exclude<EmailTier, null>;

export interface VerificationTierCount {
  tier: VerificationTier;
  count: number;
}

/** Stable order top-to-bottom in the ladder. Sendable bucket comes first
 *  (corresponded → hunter_verified → neverbounce_valid → neverbounce_catchall),
 *  then uncertain (neverbounce_unknown → unverified), then blocked
 *  (generic_blocked → neverbounce_invalid → neverbounce_disposable → bounced). */
export const VERIFICATION_TIER_ORDER: VerificationTier[] = [
  "corresponded",
  "hunter_verified",
  "neverbounce_valid",
  "neverbounce_catchall",
  "neverbounce_unknown",
  "unverified",
  "generic_blocked",
  "neverbounce_invalid",
  "neverbounce_disposable",
  "bounced",
];

/**
 * Fetch per-tier counts for the active campaign. We resolve the
 * campaign's `campaign_partners` rows, pull the `partner_id` list, then
 * count `partners_mirror.email_tier` values for that set.
 *
 * Two Supabase round-trips rather than a head-count-per-tier loop to
 * keep row counts scannable in the Supabase logs and avoid 5 parallel
 * `count=exact` requests per page render.
 *
 * Returns every tier (count = 0 when none) so the caller can render the
 * ladder without a tier-absent branch. On error returns all zeros — the
 * page's honest empty state handles that.
 */
export async function getVerificationCounts(
  campaignId: string,
): Promise<VerificationTierCount[]> {
  const zeros = (): VerificationTierCount[] =>
    VERIFICATION_TIER_ORDER.map((tier) => ({ tier, count: 0 }));

  if (!campaignId) return zeros();
  const supabase = await createServerClient();

  // 1) Partner ids on this campaign's campaign_partners join.
  const { data: cpRows, error: cpErr } = await supabase
    .from("campaign_partners")
    .select("partner_id")
    .eq("campaign_id", campaignId);

  if (cpErr) {
    console.error("getVerificationCounts campaign_partners fetch failed:", cpErr.message);
    return zeros();
  }

  const partnerIds = (cpRows ?? [])
    .map((r) => (r as { partner_id: number | null }).partner_id)
    .filter((id): id is number => typeof id === "number");

  if (partnerIds.length === 0) return zeros();

  // 2) Pull email_tier for each partner. We need a full scan rather than a
  //    distinct/aggregate because Supabase-JS doesn't expose GROUP BY; the
  //    row count is bounded by campaign size (~hundreds), so this is fine.
  const { data: partnerRows, error: partnerErr } = await supabase
    .from("partners_mirror")
    .select("email_tier")
    .in("id", partnerIds);

  if (partnerErr) {
    console.error("getVerificationCounts partners_mirror fetch failed:", partnerErr.message);
    return zeros();
  }

  // 3) Aggregate. NULL/unknown tiers roll into `unverified` — it's the
  //    honest bucket for "we haven't confirmed this yet".
  const counts = new Map<VerificationTier, number>();
  for (const tier of VERIFICATION_TIER_ORDER) counts.set(tier, 0);

  for (const row of partnerRows ?? []) {
    const raw = (row as { email_tier: string | null }).email_tier;
    const tier: VerificationTier = (
      raw && (VERIFICATION_TIER_ORDER as string[]).includes(raw)
        ? (raw as VerificationTier)
        : "unverified"
    );
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }

  return VERIFICATION_TIER_ORDER.map((tier) => ({
    tier,
    count: counts.get(tier) ?? 0,
  }));
}

/**
 * Returns per-tier identifier bundles for the active campaign. Used by
 * the verification gate buttons to decide which partners to operate on
 * for tier-wide actions (queue Hunter for every generic-inbox partner,
 * mark every bounced partner inactive, etc.).
 *
 * Implementation mirrors `getVerificationCounts` — one round-trip for
 * the campaign's campaign_partners + partner ids, a second for the
 * partners_mirror rows with email_tier + investor_id. NULL `email_tier`
 * rolls into `unverified` so the buttons operate on a consistent bucket
 * with the gate's counts.
 */
export async function getVerificationTierRefs(
  campaignId: string,
): Promise<Record<VerificationTier, VerificationTierRefs>> {
  const empty = (): Record<VerificationTier, VerificationTierRefs> => {
    const out = {} as Record<VerificationTier, VerificationTierRefs>;
    for (const tier of VERIFICATION_TIER_ORDER) {
      out[tier] = {
        campaignPartnerIds: [],
        partnerIds: [],
        firstInvestorId: null,
      };
    }
    return out;
  };

  if (!campaignId) return empty();

  const supabase = await createServerClient();

  // Campaign partner rows with their partner_id — (campaign_partner_id,
  // partner_id) pairs for downstream bucketing.
  const { data: cpRows, error: cpErr } = await supabase
    .from("campaign_partners")
    .select("id, partner_id")
    .eq("campaign_id", campaignId);

  if (cpErr) {
    console.error("getVerificationTierRefs campaign_partners fetch failed:", cpErr.message);
    return empty();
  }

  const pairs = (cpRows ?? [])
    .map((r) => r as { id: string; partner_id: number | null })
    .filter((r): r is { id: string; partner_id: number } =>
      typeof r.partner_id === "number",
    );

  if (pairs.length === 0) return empty();

  const partnerIdList = pairs.map((p) => p.partner_id);

  const { data: partnerRows, error: partnerErr } = await supabase
    .from("partners_mirror")
    .select("id, email_tier, investor_id")
    .in("id", partnerIdList);

  if (partnerErr) {
    console.error("getVerificationTierRefs partners_mirror fetch failed:", partnerErr.message);
    return empty();
  }

  // Map partner_id → (tier, investor_id). NULL tiers fold to `unverified`.
  const partnerMeta = new Map<
    number,
    { tier: VerificationTier; investorId: number | null }
  >();
  for (const row of partnerRows ?? []) {
    const r = row as {
      id: number;
      email_tier: string | null;
      investor_id: number | null;
    };
    const tier: VerificationTier =
      r.email_tier && (VERIFICATION_TIER_ORDER as string[]).includes(r.email_tier)
        ? (r.email_tier as VerificationTier)
        : "unverified";
    partnerMeta.set(r.id, { tier, investorId: r.investor_id });
  }

  const out = empty();
  for (const { id: cpId, partner_id } of pairs) {
    const meta = partnerMeta.get(partner_id) ?? {
      tier: "unverified" as VerificationTier,
      investorId: null,
    };
    const bucket = out[meta.tier];
    bucket.campaignPartnerIds.push(cpId);
    bucket.partnerIds.push(partner_id);
    if (bucket.firstInvestorId === null && meta.investorId !== null) {
      bucket.firstInvestorId = meta.investorId;
    }
  }

  return out;
}
