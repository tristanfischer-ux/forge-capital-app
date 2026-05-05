"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
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
      <FindAMatch
        campaignId=""
        campaignName="Discovery"
        initialData={initialData}
        initialArchetype="investor"
        onSelectedIds={handleSelectedIds}
      />

      <AddToCampaignBar
        campaigns={campaigns}
        selectedInvestorIds={selectedIds}
      />

      {/* Navigation to pipeline dashboard */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: 16,
        padding: "20px 0 40px",
      }}>
        <Link
          href="/pipeline"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid var(--accent)",
            textDecoration: "none",
          }}
        >
          Go to My Pipeline →
        </Link>
        <Link
          href="/investors"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-dim)",
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            textDecoration: "none",
          }}
        >
          View All Investors (cross-campaign)
        </Link>
      </div>
    </>
  );
}
