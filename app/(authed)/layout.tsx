import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { CampaignDropdown } from "./CampaignDropdown";
import { TopNav } from "./TopNav";
import { WalkTourStrip } from "./WalkTourStrip";
import { EmailHuntModal } from "./match/EmailHuntModal";
import { Breadcrumbs, BreadcrumbsProvider } from "./Breadcrumbs";
import { OpusChatBar } from "./OpusChatBar";


/**
 * Authed shell — 1:1 port of V4 topbar + layout chrome
 * (Phase2-Mockup-V4.html lines 719-744, 901-903).
 *
 * V4 CSS class names used verbatim (from app/v4-mockup.css):
 *   - `.topbar`                — sticky header row
 *   - `.brand` / `.dot` / `.sub` — rotated-square logo + wordmark
 *   - `.topnav` / `.pill` / `.pill.active` / `.pill.auto` — 8 nav pills
 *   - `.spacer`                — pushes right-side controls to the edge
 *   - `.campaign-switcher` / `.label` / `.name` / `.type-badge` +
 *     `.type-badge-inv|cus|sup` / `.caret`
 *   - `.new-camp-btn`          — "+" indigo circle
 *   - `.user-chip`             — "TF" avatar
 *   - `.layout` / `.main` / `.side` — 1440px two-column frame
 *
 * Auth: V1 does not gate layout-level — RLS is the security boundary
 * (`007_rls.sql`). Middleware redirects unauthed users off /tracker.
 */
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const campaigns = await listActiveCampaigns();

  // Resolve the active campaign for the top-bar switcher. Layouts don't
  // receive searchParams in Next 16, so we read `fc_active_campaign`
  // from the cookie written by CampaignDropdown on navigation. Page-level
  // `?c=<uuid>` still wins for the main content.
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const activeCampaignId = resolveCurrentCampaignId(campaigns, cookieCampaign);
  const totalActive = campaigns.length;

  const activeCampaignName =
    campaigns.find((c) => c.id === activeCampaignId)?.name ?? null;

  return (
    <BreadcrumbsProvider>
      <TopBar
        campaigns={campaigns}
        activeCampaignId={activeCampaignId}
        totalActive={totalActive}
      />
      <OpusChatBar activeCampaignName={activeCampaignName} />
      {/* Sidebar deleted 2026-04-22: Tristan flagged the four panels
          (Drafts ready / Pipeline health / Rhythm / Tracker health) as
          wasted space and demo-data-leaky (Stephan references). Content
          now fills full width. The sidebarCampaign resolver stays
          because Sidebar.tsx may return in a different shape later. */}
      <div
        className="layout"
        style={{ gridTemplateColumns: "minmax(0, 1fr)" }}
      >
        <main className="main">
          {/* Breadcrumb strip — auto-derived from pathname via
              lib/ui/breadcrumb-schema. Sits above the walk-tour callout
              so the hierarchy reads: topbar · breadcrumbs · tour ·
              content. Pages with dynamic segments (/investor/[id],
              /tracker/[id]/draft) can render <BreadcrumbsOverride
              label="..." /> inside their body to swap the final crumb
              for a human-readable string. */}
          <Breadcrumbs />
          <WalkTourStrip />
          {children}
        </main>
      </div>
      {/* Shell-level EmailHuntModal (lifted 2026-04-22 from FindAMatch).
          Subscribes to the global `fc:resolve-email` custom event so any
          surface — find-a-match result cards, verification-gate "Resolve
          email" button, future places — can open the modal by dispatching
          `new CustomEvent("fc:resolve-email", { detail: { investorId } })`.
          Always-mounted, native <dialog> handles focus + Escape. */}
      <EmailHuntModal />
    </BreadcrumbsProvider>
  );
}

/**
 * Top bar — renders V4's `.topbar` markup verbatim. The 8 pills use
 * `<NavPill>` (client, pathname-aware) — on /home they resolve to plain
 * `#anchor` scroll links, on any deep-link route they resolve to
 * `<Link href="/pipeline#anchor">` so clicking the pill brings the user to
 * the pipeline page scrolled to the section.
 *
 * See ./NavPill.tsx for the routing logic. Anchor ids match the V4
 * mockup: #find-a-match, #approval, #automation, #templates, #review,
 * #verification, #drafts, #tracker, #weekly.
 */
function TopBar({
  campaigns,
  activeCampaignId,
  totalActive,
}: {
  campaigns: Awaited<ReturnType<typeof listActiveCampaigns>>;
  activeCampaignId: string | null;
  totalActive: number;
}) {
  return (
    <header className="topbar">
      {/* Brand mark — V4 line 723 */}
      <Link href="/discover" className="brand">
        <span className="dot" aria-hidden="true" />
        Fractional Forge
        <span className="sub">Outreach</span>
      </Link>

      {/* Nav pills — V4 lines 724-733, full 8-pill set, with scroll-spy
          highlighting on /home. TopNav is a single client component that
          subscribes to scroll position and marks the pill matching the
          currently-visible section with `.pill.active`. On deep-link
          routes it falls back to pathname matching. See ./TopNav.tsx. */}
      <TopNav />

      {/* Spacer — V4 line 734 pushes right controls to the edge */}
      <div className="spacer" />

      {/* Campaign switcher — V4 lines 735-741. Renders null if no
          campaigns are visible (RLS-denied); the sign-in hint below
          takes its place. */}
      {campaigns.length > 0 ? (
        <CampaignDropdown
          campaigns={campaigns}
          activeCampaignId={activeCampaignId}
          totalActive={totalActive}
        />
      ) : (
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          No campaigns visible &mdash; sign in to load your tracker.
        </span>
      )}

      {/* "+" new-campaign button — V4 line 742. Disabled in V1 until
          campaign creation ships (Phase 5). The affordance stays visible
          for visual parity. */}
      <button
        type="button"
        className="new-camp-btn"
        disabled
        title="Campaign creation lands in a later section"
        aria-label="New campaign (not yet enabled)"
        style={{ opacity: 0.6, cursor: "not-allowed" }}
      >
        +
      </button>

      {/* User chip — V4 line 743 */}
      <div className="user-chip" aria-label="Tristan Fischer">
        TF
      </div>
    </header>
  );
}

