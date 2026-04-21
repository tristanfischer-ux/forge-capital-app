import Link from "next/link";
import { listActiveCampaigns } from "@/lib/queries/campaigns";

/**
 * Authed-shell layout. Renders the top bar + campaign switcher chrome
 * from Phase2-Mockup-V4. Wrapping the tracker (and future authed pages)
 * inside the route group `(authed)` means we can add middleware-based
 * auth gating later without changing URLs.
 *
 * V1: no auth gate here yet — Tristan-only RLS in the DB is the
 * security boundary (`007_rls.sql`). Middleware lands in Phase 5.
 */

// Server component — reads URL params via its children; the switcher
// itself is a set of Link chips that swap `?c=<uuid>` on click.
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const campaigns = await listActiveCampaigns();

  return (
    <div className="min-h-screen bg-bg">
      {/* Top bar — port of V4 `.topbar` */}
      <header className="sticky top-0 z-50 flex items-center gap-5 border-b border-border bg-surface px-7 py-3.5 shadow-[var(--shadow)]">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="block h-2.5 w-2.5 rotate-45 bg-accent"
            style={{ borderRadius: 3 }}
          />
          <span className="text-[17px] font-bold tracking-tight text-accent">
            Fractional Forge
          </span>
          <span className="ml-1 text-[17px] font-medium text-text">
            Outreach
          </span>
        </Link>

        <nav className="ml-2.5 flex gap-0.5">
          <Link
            href="/tracker"
            className="inline-flex items-center rounded-[8px] bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white"
          >
            Tracker
          </Link>
        </nav>

        <div className="flex-1" />

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-light text-xs font-semibold text-accent">
          TF
        </div>
      </header>

      {/* Campaign switcher chip row — horizontal scrollable strip */}
      <div className="border-b border-border bg-surface px-7 py-2.5">
        <CampaignSwitcherStrip campaigns={campaigns} />
      </div>

      <main className="mx-auto max-w-[1440px] px-7 py-6">{children}</main>
    </div>
  );
}

/**
 * Horizontal chip row at the top of the authed layout. Each chip is a
 * Link with `?c=<uuid>` so the server component receives the selection
 * via search params and refetches. The server doesn't know which chip
 * is active here — the page component is responsible for rendering the
 * active state (we deliberately keep the switcher stateless).
 *
 * Empty state: no campaigns at all (unauthenticated or RLS denied).
 */
function CampaignSwitcherStrip({
  campaigns,
}: {
  campaigns: Awaited<ReturnType<typeof listActiveCampaigns>>;
}) {
  if (campaigns.length === 0) {
    return (
      <div className="text-[12px] text-text-dim">
        No campaigns visible. Sign in as{" "}
        <code className="rounded-sm bg-surface-alt px-1 py-0.5 font-mono text-[11px]">
          tristan.fischer@gmail.com
        </code>{" "}
        to load your tracker.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-text-dim">
        Campaign
      </span>
      {campaigns.map((campaign) => (
        <Link
          key={campaign.id}
          href={`/tracker?c=${campaign.id}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text hover:border-accent hover:text-accent"
        >
          <span>{campaign.name}</span>
          <span className="rounded-full bg-surface-alt px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-dim">
            {campaign.partner_count}
          </span>
          <IntentBadge intent={campaign.campaign_intent} />
        </Link>
      ))}
    </div>
  );
}

function IntentBadge({
  intent,
}: {
  intent: "investor" | "customer" | "supplier";
}) {
  // Mirrors V4's `.type-badge-{inv,cus,sup}` tokens — see tailwind config.
  const byIntent = {
    investor:
      "bg-intent-investor-bg text-intent-investor-fg border-intent-investor-border",
    customer:
      "bg-intent-customer-bg text-intent-customer-fg border-intent-customer-border",
    supplier:
      "bg-intent-supplier-bg text-intent-supplier-fg border-intent-supplier-border",
  } as const;
  const label = {
    investor: "Investor",
    customer: "Customer",
    supplier: "Supplier",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${byIntent[intent]}`}
    >
      {label[intent]}
    </span>
  );
}
