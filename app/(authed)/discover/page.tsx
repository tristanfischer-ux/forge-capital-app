import { Suspense } from "react";
import { getMatchScore } from "@/lib/queries/match-score";
import { heroTextForArchetype } from "../match/match-constants";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import { StageBanner } from "../StageBanner";
import { DiscoverClient } from "./DiscoverClient";

/**
 * Discovery page — pure search-and-select.
 *
 * Find investors, select them, add to a campaign. No archetype selection,
 * no customer/supplier branching. Just investor search with multi-select
 * filters and checkbox-based selection.
 */
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  return (
    <>
      <StageBanner number={1} title="Discovery" />

      <div id="find-a-match">
        <Suspense fallback={<DiscoverSkeleton />}>
          <FindAMatchSection />
        </Suspense>
      </div>
    </>
  );
}

async function FindAMatchSection() {
  const [rawData, campaigns] = await Promise.all([
    getMatchScore({
      heroText: heroTextForArchetype("investor"),
      archetype: "investor",
      campaignId: "",
      limit: 10,
      tab: "best",
    }),
    listActiveCampaigns(),
  ]);

  // Strip near-miss text from the initial server render — computed against
  // the default seed text, not what the user actually typed.
  const initialData = {
    ...rawData,
    rows: rawData.rows.map((r) => ({ ...r, near_miss: null })),
  };

  return (
    <DiscoverClient
      initialData={initialData}
      campaigns={campaigns}
    />
  );
}

function DiscoverSkeleton() {
  return (
    <section
      className="section"
      style={{
        minHeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "repeating-linear-gradient(45deg, var(--surface-alt) 0 10px, var(--surface) 10px 20px)",
        border: "1px dashed var(--border)",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--text-faint)",
        }}
      >
        Discovery · loading…
      </span>
    </section>
  );
}
