import { redirect } from "next/navigation";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getMatchScore, type Archetype } from "@/lib/queries/match-score";
import { FindAMatch } from "./FindAMatch";
import { DEFAULT_HERO_TEXT } from "./match-constants";

/**
 * Match page — §3 Find-a-Match. Ports Phase2-Mockup-V4.html §"Find a
 * match" (lines 912–1147) 1:1. The old V1 grid (`MatchGrid.tsx` +
 * `MatchFilters.tsx`) is retired — V4's richer design lands on this
 * route directly.
 *
 * Server component: fetches the archetype pool size + an initial scored
 * top-10 against the V4 SkySails sample text so the first paint is
 * non-empty. Subsequent edits to the hero text invoke the server
 * action from the client component.
 *
 * `dynamic = "force-dynamic"` because the page reads search params and
 * Supabase RLS context mid-request.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  c?: string;
  a?: string;
}>;

function parseArchetype(raw: string | undefined): Archetype {
  if (raw === "customer" || raw === "supplier") return raw;
  return "investor";
}

export default async function MatchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const campaigns = await listActiveCampaigns();
  const campaignId = resolveCurrentCampaignId(campaigns, params.c);

  if (!campaignId) {
    redirect("/tracker");
  }
  if (!params.c) {
    redirect(`/match?c=${campaignId}&a=${parseArchetype(params.a)}`);
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const archetype = parseArchetype(params.a);

  // Seed the initial results with the V4 SkySails sample text so the
  // first paint has real cards. The client component persists whatever
  // the user types in localStorage and re-runs the query on submit.
  // Enhancement wave 2026-04-22: default page size is 25 and the scorer
  // sweeps the 2,000-row candidate pool (was 10 / 600). Client component
  // handles Load-more pagination by asking the server for a larger limit.
  const initialData = await getMatchScore({
    heroText: DEFAULT_HERO_TEXT,
    archetype,
    campaignId,
    limit: 25,
    tab: "best",
  });

  return (
    <FindAMatch
      campaignId={campaignId}
      campaignName={activeCampaign?.name ?? "this campaign"}
      initialData={initialData}
      initialArchetype={archetype}
    />
  );
}
