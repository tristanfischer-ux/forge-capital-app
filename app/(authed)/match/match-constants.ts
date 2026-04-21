/**
 * Shared constants for the §3 Find-a-Match surface. Split from
 * `FindAMatch.tsx` so the server component page can import them without
 * crossing the "use client" boundary. Next 16 RSC strips non-function
 * exports across that boundary in some builds, leaving the constant
 * undefined at runtime (manifests as "text.match is not a function"
 * when the server hands an undefined through to auto-suggest).
 */

/**
 * V4-verbatim SkySails sample pitch text from Phase2-Mockup-V4.html
 * line 920 (the textarea's default content). First-load seed only —
 * the client component persists whatever the user types in localStorage
 * per campaign and hydrates from there on subsequent mounts.
 */
export const DEFAULT_HERO_TEXT =
  "SkySails Power. Series A, €20-30m. Airborne wind energy — flying kite generates power at half the capex of offshore. Pilot live in Mauritius with the Central Electricity Board. Looking for deep-tech / cleantech investors who follow complex hardware through TRL 7-9, ideally with offshore, grid-scale or frontier-energy theses. Strong preference for funds that have previously written €5m+ first cheques into hardware capex businesses. EU + UK priority, US West Coast welcome.";
