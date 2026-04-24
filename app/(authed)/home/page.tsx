import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getMatchScore, type Archetype } from "@/lib/queries/match-score";
import { FindAMatch } from "../match/FindAMatch";
import { heroTextForArchetype } from "../match/match-constants";

import ApprovalPage from "../approval/page";
import PipelinePage from "../pipeline/page";
import TemplatesPage from "../templates/page";
import ReviewPage from "../review/page";
import VerificationPage from "../verification/page";
import DraftsPage from "../drafts/page";
import TrackerPage from "../tracker/page";
import WeeklyPage from "../weekly/page";

/**
 * V4 single-page home — the whole app on one scroll, as V4 specifies
 * (CLAUDE.md §"Architecture — locked": "V4 is one scrolling page. Not
 * multi-route. The 8 topbar pills are anchor-scroll targets").
 *
 * V4 anchor order (Phase2-Mockup-V4.html lines 913-2175):
 *   1. #find-a-match   — §3 Find a Match       (913)
 *   2. #approval       — §9 Approval two-way   (1149)
 *   3. #automation     — §4 Pipeline lanes     (1297)
 *   4. #templates      — §6 Templates          (1448)
 *   5. #review         — §5 Eyeball review     (1526)
 *   6. #verification   — §7 Email gate         (1648 — V4 has no id attr;
 *                        we add `id="verification"` for the pill-scroll
 *                        target. The existing /verification route already
 *                        wraps its body in `<section id="verification">`.)
 *   7. #drafts         — §8 Gmail drafts       (1715)
 *   8. #tracker        — §2 Master tracker     (1799)
 *   9. #weekly         — §10 Weekly update     (1872)
 *
 * Approach A (per spec): compose by invoking each section's existing
 * `page.tsx` default export as an async server component. Each section
 * already returns `<section id="X" className="section">…</section>` with
 * its own data fetch + rendering, so stacking them here produces the V4
 * single-page layout without re-deriving queries.
 *
 * The one exception is Find-a-Match — its page-level default export
 * redirects on a missing `?c=` (to rewrite the URL with the campaign +
 * archetype), which we must NOT trigger from /home. We inline its fetch
 * + render here so the home page stays a single URL.
 *
 * Scroll-anchor behaviour: V4's CSS sets
 * `html { scroll-behavior: smooth; scroll-padding-top: 80px; }`
 * (app/v4-mockup.css line 34), imported globally — the pills in the
 * top bar use `<a href="#anchor">` on /home and `<Link href="/home#anchor">`
 * elsewhere (see ../TopNav.tsx).
 *
 * Force-dynamic: the composed sections read cookies + search params.
 * Default caching would pin the first-requested campaign across users.
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Resolve campaign once — all sections share the same campaign
  // selection. ?c=<uuid> wins; else the `fc_active_campaign` cookie set
  // by CampaignDropdown; else the first active campaign.
  const campaigns = await listActiveCampaigns();
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId = resolveCurrentCampaignId(
    campaigns,
    params.c ?? cookieCampaign,
  );

  // No campaigns visible at all — usually an unauthenticated / RLS-denied
  // session. Render the same single-card empty state the other routes use
  // so the sign-in affordance is one click away.
  if (!campaignId) {
    return <NoCampaignsState />;
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);

  // Archetype follows the active campaign's campaign_intent by
  // default (customer campaign → Customer, supplier → Supplier,
  // investor → Investor). An explicit ?a= in the URL overrides so
  // Tristan can still explore the investor pool from a customer
  // campaign's context. Previously we defaulted to "investor"
  // unconditionally, so switching to the Fischer Farms customer
  // campaign still opened Find-a-Match in investor mode with stale
  // SkySails text (Tristan 2026-04-24).
  const archetype: Archetype =
    parseArchetype(params.a) ??
    archetypeFromCampaignIntent(activeCampaign?.campaign_intent ?? null);

  // §3 Find-a-Match — initial scored top-10 against an
  // archetype-appropriate sample text so the first paint has real
  // cards on investor campaigns and a Fischer Farms-shaped description
  // on customer campaigns. Client-side edits re-run the query via the
  // shared server action (see match/match-v4-actions.ts).
  const findMatchInitial = await getMatchScore({
    heroText: heroTextForArchetype(archetype),
    archetype,
    campaignId,
    limit: 10,
    tab: "best",
  });

  // Each section's existing page component takes the same `searchParams`
  // promise. We forward ours so they see the same `?c=` and can resolve
  // the campaign identically. DraftsPage ignores searchParams (it spans
  // every campaign), so we don't pass anything there.
  //
  // We also pass `initialCampaigns` + `initialCampaignId` so each section
  // reuses our already-resolved data instead of re-running
  // `listActiveCampaigns()` + cookies() independently. Before this,
  // composing /home fired ~7 identical campaign queries + cookie reads
  // per request. Each section still falls back to its own fetch when
  // invoked directly (e.g. /tracker, /review), so deep-link URLs work
  // unchanged.
  //
  // Every one of these default exports is an async server component and
  // returns `<section id="…" className="section">…</section>` — stacking
  // them produces V4's single-page scroll 1:1.
  return (
    <>
      {/* ──────────────── 1. Find a Match ──────────────── */}
      <FindAMatch
        campaignId={campaignId}
        campaignName={activeCampaign?.name ?? "this campaign"}
        initialData={findMatchInitial}
        initialArchetype={archetype}
      />

      {/* ──────────────── 2. Approval ──────────────── */}
      <ApprovalPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 3. Automation pipeline ──────────────── */}
      <PipelinePage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 4. Templates ──────────────── */}
      <TemplatesPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 5. Eyeball review ──────────────── */}
      <ReviewPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 6. Email verification gate ──────────────── */}
      <VerificationPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 7. Gmail drafts ──────────────── */}
      {/* DraftsPage default export takes no props — it queries across
          every campaign by design (drafts surface per-campaign chips). */}
      <DraftsPage />

      {/* ──────────────── 8. Tracker ──────────────── */}
      <TrackerPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />

      {/* ──────────────── 9. Weekly counterpart update ──────────────── */}
      <WeeklyPage
        searchParams={searchParams}
        initialCampaigns={campaigns}
        initialCampaignId={campaignId}
      />
    </>
  );
}

/**
 * Shown when no campaigns are visible to the session — usually means the
 * user is unauthenticated and RLS denied the `campaigns` read. Mirrors
 * the equivalent card used by /tracker, /review, /approval, etc.
 */
function NoCampaignsState() {
  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 640,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 32,
        textAlign: "center",
        boxShadow: "var(--shadow)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
        No campaigns available
      </h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        Sign in to load your home page. Row-level security gates every
        table until an authenticated session is present.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
        style={{ marginTop: 20, display: "inline-block" }}
      >
        Go to sign-in
      </Link>
    </div>
  );
}
