import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { CampaignDropdown } from "./CampaignDropdown";
import { NavPill } from "./NavPill";
import { Sidebar } from "./Sidebar";
import { WalkTourStrip } from "./WalkTourStrip";

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

  // Resolve which campaign the sidebar should render for. Layouts don't
  // receive searchParams in Next 16, so we read an `fc_active_campaign`
  // cookie written by CampaignDropdown on navigation and fall back to
  // the first active campaign. Page-level `?c=<uuid>` still wins for
  // the main content — this only affects which campaign's health rail
  // shows on the right.
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const sidebarCampaignId = resolveCurrentCampaignId(campaigns, cookieCampaign);
  const sidebarCampaign =
    campaigns.find((c) => c.id === sidebarCampaignId) ?? null;
  const totalActive = campaigns.length;

  return (
    <>
      <TopBar
        campaigns={campaigns}
        activeCampaignId={sidebarCampaignId}
        totalActive={totalActive}
      />
      <div className="layout">
        <main className="main">
          <WalkTourStrip />
          {children}
        </main>
        {sidebarCampaign ? <Sidebar campaign={sidebarCampaign} /> : null}
      </div>
    </>
  );
}

/**
 * Top bar — renders V4's `.topbar` markup verbatim. The 8 pills use
 * `<NavPill>` (client, pathname-aware) — on /home they resolve to plain
 * `#anchor` scroll links, on any deep-link route they resolve to
 * `<Link href="/home#anchor">` so clicking the pill brings the user to
 * the single-page home scrolled to the section.
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
      <Link href="/home" className="brand">
        <span className="dot" aria-hidden="true" />
        Fractional Forge
        <span className="sub">Outreach</span>
      </Link>

      {/* Nav pills — V4 lines 724-733, full 8-pill set. V4 is one
          scrolling page (`/home`), so each pill is a scroll anchor on
          /home and a `Link` back to `/home#anchor` on any deep-link
          route. See ./NavPill.tsx for the routing logic. */}
      <nav className="topnav">
        <NavPill
          anchor="find-a-match"
          label="Find a match"
          deepLinkPath="/match"
        />
        <NavPill
          anchor="approval"
          label="Approval"
          deepLinkPath="/approval"
        />
        <NavPill
          anchor="automation"
          label="Automation"
          deepLinkPath="/pipeline"
          auto
        />
        <NavPill
          anchor="templates"
          label="Templates"
          deepLinkPath="/templates"
        />
        <NavPill anchor="review" label="Review" deepLinkPath="/review" />
        <NavPill
          anchor="drafts"
          label="Drafts"
          deepLinkPath="/drafts"
        />
        <NavPill
          anchor="tracker"
          label="Tracker"
          deepLinkPath="/tracker"
        />
        <NavPill
          anchor="weekly"
          label="Weekly"
          deepLinkPath="/weekly"
        />
      </nav>

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

