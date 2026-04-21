import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier } from "@/lib/queries/tracker";

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

/** Stable order top-to-bottom in the ladder. 100% comes first. */
export const VERIFICATION_TIER_ORDER: VerificationTier[] = [
  "corresponded",
  "hunter_verified",
  "unverified",
  "generic_blocked",
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
