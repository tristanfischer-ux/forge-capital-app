import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * Pure helpers that don't touch Supabase. Split from `campaigns.ts` so
 * they're safe to import from client components — the query file pulls
 * `@/lib/supabase/server.ts` at the top, which transitively drags
 * `next/headers` into any "use client" bundle that imports from it.
 *
 * Same sibling convention used by `match-score-types.ts` / `lookalikes-types.ts`.
 */

/** Returns the counterpart_name if set, else a fallback. Callers pass
 *  a variant — "title" for headings ("Andrew Murphy"), "phrase" for
 *  mid-sentence use ("your counterpart"), or "possessive" for things
 *  like "Stephan's reply" → "your counterpart's reply". Used
 *  everywhere the V4 mockup hardcoded "Stephan". */
export function counterpartLabel(
  campaign: Pick<CampaignSummary, "counterpart_name">,
  variant: "title" | "phrase" | "possessive" = "phrase",
): string {
  const name = campaign.counterpart_name?.trim();
  if (name) {
    if (variant === "possessive") {
      // "Andrew" → "Andrew's"; "Mary Ellis" → "Mary Ellis's"
      return name.endsWith("s") ? `${name}'` : `${name}'s`;
    }
    return name;
  }
  if (variant === "title") return "Counterpart TBD";
  if (variant === "possessive") return "the counterpart's";
  return "the counterpart";
}

/**
 * Resolve the user-facing display label for a campaign. Returns
 * `display_name` when set (migration 027, UX audit 2026-04-23 item #2)
 * and falls back to `name` otherwise so nothing renders blank during
 * rollout of new campaigns that haven't set a display label yet.
 *
 * Use this helper EVERYWHERE a campaign label crosses the founder /
 * counterparty boundary — email subjects, approval sheet titles /
 * filenames, weekly digest headers, outbound `[APPROVAL]` email
 * subjects. Internal surfaces (tracker admin rows, sidebar chips,
 * URL slugs, debug log lines) can keep using `.name` directly since
 * the whole point of the split is that `.name` is the auditable
 * internal token.
 */
export function displayNameFor(
  campaign:
    | { name: string | null; display_name: string | null }
    | Pick<CampaignSummary, "name" | "display_name">
    | null
    | undefined,
): string {
  if (!campaign) return "Campaign";
  const trimmed = campaign.display_name?.trim();
  if (trimmed) return trimmed;
  return campaign.name?.trim() || "Campaign";
}

/** Compute "Week N of M" from the campaign's week_started_at clock.
 *  Returns null if week_started_at isn't set — UI falls back to an
 *  honest "Week 1 · starting" or just the campaign name. */
export function computeCampaignWeek(
  campaign: Pick<CampaignSummary, "week_started_at" | "week_count_target">,
): { current: number; total: number } | null {
  if (!campaign.week_started_at) return null;
  const start = new Date(campaign.week_started_at);
  if (Number.isNaN(start.getTime())) return null;
  const elapsedMs = Date.now() - start.getTime();
  const weeksElapsed = Math.floor(elapsedMs / (7 * 24 * 60 * 60 * 1000));
  const current = Math.max(1, weeksElapsed + 1);
  const total = campaign.week_count_target ?? 16;
  return { current, total };
}

/**
 * Resolves the "current campaign" id for the tracker page. V1 behaviour:
 * read from the `?c=<uuid>` search param. If absent or invalid, return
 * the first active campaign as a sensible default so the page renders.
 * Returns null only if there are no campaigns at all.
 */
export function resolveCurrentCampaignId(
  campaigns: CampaignSummary[],
  searchParamC: string | undefined,
): string | null {
  if (campaigns.length === 0) return null;
  if (searchParamC && campaigns.some((c) => c.id === searchParamC)) {
    return searchParamC;
  }
  return campaigns[0].id;
}
