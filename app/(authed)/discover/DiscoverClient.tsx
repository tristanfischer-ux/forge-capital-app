"use client";

import { useCallback, useState } from "react";
import { FindAMatch } from "../match/FindAMatch";
import { AddToCampaignBar } from "./AddToCampaignBar";
import type { GetMatchScoreResult } from "@/lib/queries/match-score-types";
import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * Client-side coordinator for the Discovery page.
 * Bridges FindAMatch (search + selection) to AddToCampaignBar (bulk add).
 */
export function DiscoverClient({
  initialData,
  campaigns,
}: {
  initialData: GetMatchScoreResult;
  campaigns: CampaignSummary[];
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const handleSelectedIds = useCallback((ids: number[]) => {
    setSelectedIds(ids);
  }, []);

  return (
    <>
      <AddToCampaignBar
        campaigns={campaigns}
        selectedInvestorIds={selectedIds}
      />

      <FindAMatch
        campaignId=""
        campaignName="Discovery"
        initialData={initialData}
        initialArchetype="investor"
        onSelectedIds={handleSelectedIds}
      />
    </>
  );
}
