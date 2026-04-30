import { redirect } from "next/navigation";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getMatchScore, type Archetype } from "@/lib/queries/match-score";
import { FindAMatch } from "./FindAMatch";
import { heroTextForArchetype } from "./match-constants";
import { listCustomerCampaignPartners } from "@/lib/queries/customer-partners";
import { StageBanner } from "../StageBanner";

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

function parseArchetype(raw: string | undefined): Archetype | null {
  if (raw === "investor" || raw === "customer" || raw === "supplier") return raw;
  return null;
}

function archetypeFromCampaignIntent(
  intent: string | null | undefined,
): Archetype {
  if (intent === "customer" || intent === "supplier") return intent;
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

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);

  // Archetype follows the active campaign's `campaign_intent` by
  // default — a customer campaign opens on the Customer archetype, a
  // supplier campaign opens on Supplier, an investor campaign on
  // Investor. An explicit `?a=` query param overrides (Tristan wants
  // to explore the investor pool from a customer campaign's context).
  // Previously this defaulted to "investor" unconditionally, so
  // switching to the Fischer Farms customer campaign still opened in
  // investor mode with stale SkySails text.
  const archetype: Archetype =
    parseArchetype(params.a) ??
    archetypeFromCampaignIntent(activeCampaign?.campaign_intent ?? null);

  if (!params.c || !params.a) {
    redirect(`/match?c=${campaignId}&a=${archetype}`);
  }

  // Seed the initial results with an archetype-appropriate sample text
  // so the first paint has real cards on the investor flow and a
  // Fischer Farms-shaped description on the customer flow. The client
  // component persists whatever the user types in localStorage per
  // campaign and hydrates from there on subsequent mounts.
  const seedText = heroTextForArchetype(archetype);
  const [initialData, customerPartners] = await Promise.all([
    getMatchScore({
      heroText: seedText,
      archetype,
      campaignId,
      limit: 25,
      tab: "best",
    }),
    archetype === "customer"
      ? listCustomerCampaignPartners(campaignId)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <StageBanner number={1} title="Find a Match" />
      <FindAMatch
        campaignId={campaignId}
        campaignName={activeCampaign?.name ?? "this campaign"}
        initialData={initialData}
        initialArchetype={archetype}
        customerPartners={customerPartners}
      />
    </>
  );
}
