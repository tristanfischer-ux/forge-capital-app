import { Suspense } from "react";
import { getMatchScore, type Archetype } from "@/lib/queries/match-score";
import { FindAMatch } from "../match/FindAMatch";
import { heroTextForArchetype } from "../match/match-constants";
import { listCustomerCampaignPartners } from "@/lib/queries/customer-partners";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import { StageBanner } from "../StageBanner";
import { AddToCampaignBar } from "./AddToCampaignBar";

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

  // Fetch campaigns for the "Add to campaign" picker — the user selects
  // which campaign to inject results into, then gets redirected to
  // /pipeline#approval.
  const campaigns = await listActiveCampaigns();

  return (
    <>
      <StageBanner number={1} title="Discovery" />

      {/* ──────────────── Find a Match ──────────────── */}
      <div id="find-a-match">
        <Suspense fallback={<DiscoverSkeleton />}>
          <FindAMatchSection archetype={archetype} />
        </Suspense>
      </div>

      {/* ──────────────── Add to Campaign ──────────────── */}
      <AddToCampaignBar campaigns={campaigns} />
    </>
  );
}

async function FindAMatchSection({
  archetype,
}: {
  archetype: Archetype;
}) {
  // Discovery is campaign-agnostic, but getMatchScore needs a campaignId
  // to resolve conflict checks. We pass a sentinel empty string — the
  // scoring function treats it as "no campaign context" and skips
  // conflict resolution.
  const [initialData, customerPartners] = await Promise.all([
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
  ]);

  return (
    <FindAMatch
      campaignId=""
      campaignName="Discovery"
      initialData={initialData}
      initialArchetype={archetype}
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
