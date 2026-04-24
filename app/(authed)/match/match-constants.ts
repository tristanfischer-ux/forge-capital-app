/**
 * Shared constants for the §3 Find-a-Match surface. Split from
 * `FindAMatch.tsx` so the server component page can import them without
 * crossing the "use client" boundary. Next 16 RSC strips non-function
 * exports across that boundary in some builds, leaving the constant
 * undefined at runtime (manifests as "text.match is not a function"
 * when the server hands an undefined through to auto-suggest).
 */

/**
 * Per-archetype hero-text placeholders. First-load seed only — the
 * client component persists whatever the user types in localStorage
 * per-campaign and hydrates from there on subsequent mounts.
 *
 * Picked by the active campaign's campaign_intent so switching from an
 * investor campaign to a customer or supplier campaign resets the
 * textarea to a shape appropriate for the new goal, instead of leaving
 * the stale SkySails pitch in place.
 */
export const INVESTOR_HERO_TEXT =
  "SkySails Power. Series A, €20-30m. Airborne wind energy — flying kite generates power at half the capex of offshore. Pilot live in Mauritius with the Central Electricity Board. Looking for deep-tech / cleantech investors who follow complex hardware through TRL 7-9, ideally with offshore, grid-scale or frontier-energy theses. Strong preference for funds that have previously written €5m+ first cheques into hardware capex businesses. EU + UK priority, US West Coast welcome.";

export const CUSTOMER_HERO_TEXT =
  "Fischer Farms Containers. Modular vertical-farm shipping containers for tropical-foliage houseplants — 5-hour dispatchable light cycle, 55,000 plants per container per year, pesticide-free by construction. Container rental £30K deposit + £3K/month. Looking for retail / garden-centre / DIY / DTC plant buyers in Scandinavia, Canada, USA and Northern Europe who care about EU 2026 residue compliance, local-supply sustainability, and margin on foliage SKUs. Lead with IKEA of Sweden and Quebec hydro growers.";

export const SUPPLIER_HERO_TEXT =
  "Describe what you're sourcing. Component or service, volume needed, any material / process / certification constraints (e.g. FDA-grade stainless, CNC milling tolerances, ISO 9001), target cost-per-unit, lead-time target, preferred region. The more specific the constraints, the tighter the match against the supplier directory.";

/**
 * Back-compat: older code paths import this symbol. Points to the
 * investor default because that was the V4 seed. Prefer using
 * `heroTextForArchetype(archetype)` so campaign switches reset cleanly.
 */
export const DEFAULT_HERO_TEXT = INVESTOR_HERO_TEXT;

export function heroTextForArchetype(
  archetype: "investor" | "customer" | "supplier",
): string {
  if (archetype === "customer") return CUSTOMER_HERO_TEXT;
  if (archetype === "supplier") return SUPPLIER_HERO_TEXT;
  return INVESTOR_HERO_TEXT;
}
