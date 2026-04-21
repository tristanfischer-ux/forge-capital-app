import Link from "next/link";
import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { CampaignDropdown } from "./CampaignDropdown";
import { NavPill } from "./NavPill";
import { Sidebar } from "./Sidebar";
import { WalkTourStrip } from "./WalkTourStrip";

/**
 * Authed-shell layout. Renders the top bar + campaign dropdown chrome
 * from Phase2-Mockup-V4 (V4 lines ~719–896). Port §1 of the 9-section
 * V4 cutover — the foundation every other section sits on.
 *
 * V4 topbar elements ported:
 *   - Rotated-square logo mark (`.brand .dot`) + wordmark "Fractional
 *     Forge" / "Outreach" (accent + default text colour).
 *   - Full 8-pill nav: Find a match, Approval, Automation (NEW),
 *     Templates, Review, Drafts, Tracker, Weekly. Disabled pills
 *     (`title="Lands in a later section"`) until their sections ship.
 *   - Campaign dropdown replacing the previous chip-row (client
 *     component in CampaignDropdown.tsx).
 *   - "+" new-campaign button (disabled until campaign-creation ships).
 *   - "TF" avatar chip.
 *
 * V4 has NO left sidebar. V4's right `.side` aside is section-specific
 * content (drafts/health/etc.) and ports to the individual pages later.
 *
 * Auth: V1 does not gate layout-level — RLS is the security boundary
 * (`007_rls.sql`). Middleware redirects unauthed users off /tracker.
 *
 * Active state: the pill for the current route is highlighted. Route
 * detection runs on the server by reading the URL from next/headers.
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
  // the first active campaign. Page-level search params (?c=<uuid>) still
  // win for the main content — this only affects which campaign's health
  // rail shows on the right rail.
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const sidebarCampaignId = resolveCurrentCampaignId(campaigns, cookieCampaign);
  const sidebarCampaign = campaigns.find((c) => c.id === sidebarCampaignId) ?? null;

  return (
    <div className="min-h-screen bg-bg">
      <TopBar campaigns={campaigns} activeCampaignId={sidebarCampaignId} />
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-7 py-6 xl:flex-row xl:items-start xl:gap-6">
        <main className="min-w-0 flex-1">
          <WalkTourStrip />
          {children}
        </main>
        {sidebarCampaign ? <Sidebar campaign={sidebarCampaign} /> : null}
      </div>
    </div>
  );
}

/**
 * Top bar — 1:1 port of V4 `.topbar`. Sticky, accent indigo brand,
 * indigo-on-white pills.
 *
 * The active-pill highlight is deferred to a client-side enhancement in
 * a later section; V1 renders all pills in the default colour. The
 * tracker/match pills get real hrefs; the other six surface a disabled
 * state until their port commits land.
 */
async function TopBar({
  campaigns,
  activeCampaignId,
}: {
  campaigns: Awaited<ReturnType<typeof listActiveCampaigns>>;
  activeCampaignId: string | null;
}) {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-5 border-b border-border bg-surface px-7 py-3.5 shadow-[var(--shadow)]">
      {/* Brand mark — rotated indigo square + wordmark */}
      <Link href="/tracker" className="flex items-center gap-2">
        <span
          className="block h-2.5 w-2.5 rotate-45 bg-accent"
          style={{ borderRadius: 3 }}
          aria-hidden="true"
        />
        <span className="text-[17px] font-bold tracking-tight text-accent">
          Fractional Forge
        </span>
        <span className="ml-1 text-[17px] font-medium text-text">
          Outreach
        </span>
      </Link>

      {/* Nav pills — full 8-pill set from V4 lines 724–733 */}
      <nav className="ml-2.5 flex gap-0.5">
        <NavPill href="/match" label="Find a match" />
        <NavPillDisabled label="Approval" reason="Lands in a later section" />
        <NavPillDisabled
          label="Automation"
          reason="Lands in a later section"
          newBadge
        />
        <NavPillDisabled label="Templates" reason="Lands in a later section" />
        <NavPillDisabled label="Review" reason="Lands in a later section" />
        <NavPillDisabled label="Drafts" reason="Lands in a later section" />
        <NavPill href="/tracker" label="Tracker" />
        <NavPillDisabled label="Weekly" reason="Lands in a later section" />
      </nav>

      {/* Spacer pushes right-side controls to the far edge */}
      <div className="flex-1" />

      {/* Empty-campaigns hint is rendered below the switcher slot —
          the switcher itself returns null when there are no campaigns. */}
      {campaigns.length > 0 ? (
        <CampaignDropdown
          campaigns={campaigns}
          activeCampaignId={activeCampaignId}
        />
      ) : (
        <span className="text-[12px] text-text-dim">
          No campaigns visible &mdash; sign in to load your tracker.
        </span>
      )}

      {/* "+" new-campaign button. Disabled in V1 — campaign creation is
          Phase 5. Keep the affordance visible for visual parity. */}
      <button
        type="button"
        disabled
        title="Campaign creation lands in a later section"
        aria-label="New campaign (not yet enabled)"
        className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full bg-accent text-[16px] font-medium leading-none text-white opacity-60"
      >
        +
      </button>

      {/* User chip — initials circle. "TF" for Tristan Fischer. */}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-light text-[12px] font-semibold text-accent"
        aria-label="Tristan Fischer"
      >
        TF
      </div>
    </header>
  );
}

/**
 * Disabled nav pill — rendered for sections whose port hasn't landed.
 * Shows cursor-not-allowed + tooltip explaining when it'll work. V4's
 * "NEW" ribbon corner badge is preserved on the Automation pill.
 */
function NavPillDisabled({
  label,
  reason,
  newBadge,
}: {
  label: string;
  reason: string;
  newBadge?: boolean;
}) {
  return (
    <span
      className="relative inline-flex cursor-not-allowed items-center rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium text-text-faint opacity-70"
      title={reason}
    >
      {label}
      {newBadge ? (
        <span
          className="absolute -right-0.5 -top-1.5 rounded-md bg-[color:var(--accent-3,#db2777)] px-1 py-[1px] text-[8px] font-bold tracking-wide text-white"
          style={{ background: "#db2777" }}
        >
          NEW
        </span>
      ) : null}
    </span>
  );
}
