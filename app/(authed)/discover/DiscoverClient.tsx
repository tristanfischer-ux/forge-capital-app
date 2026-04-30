"use client";

import { useCallback, useState } from "react";
import { FindAMatch } from "../match/FindAMatch";
import { AddToCampaignBar } from "./AddToCampaignBar";
import type { GetMatchScoreResult } from "@/lib/queries/match-score-types";
import type { Archetype } from "@/lib/queries/match-score-types";
import type { CampaignSummary } from "@/lib/queries/campaigns";
import type { CustomerCampaignPartnerCard } from "@/lib/queries/customer-partners";

/**
 * Client-side coordinator for the Discovery page. Holds the scored
 * investor IDs in state so FindAMatch (which manages its own data
 * client-side) can communicate results to AddToCampaignBar.
 */
export function DiscoverClient({
  initialData,
  archetype,
  campaigns,
  customerPartners,
}: {
  initialData: GetMatchScoreResult;
  archetype: Archetype;
  campaigns: CampaignSummary[];
  customerPartners: CustomerCampaignPartnerCard[] | null;
}) {
  const [scoredIds, setScoredIds] = useState<number[]>(
    initialData.rows.map((r) => r.investor_id),
  );

  const handleScoredIds = useCallback((ids: number[]) => {
    setScoredIds(ids);
  }, []);

  return (
    <>
      <FindAMatch
        campaignId=""
        campaignName="Discovery"
        initialData={initialData}
        initialArchetype={archetype}
        customerPartners={customerPartners}
        onScoredIds={handleScoredIds}
      />

      <AddToCampaignBar
        campaigns={campaigns}
        scoredInvestorIds={scoredIds}
      />
    </>
  );
}
