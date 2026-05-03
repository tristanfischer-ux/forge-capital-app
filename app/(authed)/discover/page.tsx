import { Suspense } from "react";
import { getMatchScore, type Archetype } from "@/lib/queries/match-score";
import { heroTextForArchetype } from "../match/match-constants";
import { listCustomerCampaignPartners } from "@/lib/queries/customer-partners";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import { StageBanner } from "../StageBanner";
import { DiscoverClient } from "./DiscoverClient";

/**
 * Discovery page — the "truth database" surface.
 *
 * This is the default post-login landing page. It shows the shared
 * investor / customer / supplier pool and lets the user search, score,
 * and browse matches. Campaign-agnostic — no campaign switcher here.
 *
 * After finding matches, users inject the top N results into a specific
 * campaign via the "Add to campaign" bar, which bridges Discovery →
 * Pipeline (the personal database page at /pipeline).
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  a?: string;
}>;

function parseArchetype(raw: string | undefined): Archetype | null {
  if (raw === "investor" || raw === "customer" || raw === "supplier") return raw;
  return null;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const archetype: Archetype = parseArchetype(params.a) ?? "investor";

  return (
    <>
      <StageBanner number={1} title="Discovery" />

      {/* ──────────────── Find a Match + Add to Campaign ──────────────── */}
      <div id="find-a-match">
        <Suspense fallback={<DiscoverSkeleton />}>
          <FindAMatchSection archetype={archetype} />
        </Suspense>
      </div>
    </>
  );
}

async function FindAMatchSection({
  archetype,
}: {
  archetype: Archetype;
}) {
  const [rawData, customerPartners, campaigns] = await Promise.all([
    getMatchScore({
      heroText: heroTextForArchetype(archetype),
      archetype,
      campaignId: "",
      limit: 10,
      tab: "best",
    }),
    archetype === "customer"
      ? listCustomerCampaignPartners("")
      : Promise.resolve(null),
    listActiveCampaigns(),
  ]);

  // Strip near-miss text from the initial server render. These results
  // are computed against the archetype default (SkySails), not what the
  // user actually typed. Showing "your pitch emphasises skysails" when
  // the textarea says "family offices / agtech" is confusing. Near-miss
  // reappears once the user types their own text and clicks Find matches.
  const initialData = {
    ...rawData,
    rows: rawData.rows.map((r) => ({ ...r, near_miss: null })),
  };

  return (
    <DiscoverClient
      initialData={initialData}
      archetype={archetype}
      campaigns={campaigns}
      customerPartners={customerPartners}
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
