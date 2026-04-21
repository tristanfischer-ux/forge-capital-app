import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getTrackerRows } from "@/lib/queries/tracker";
import { TrackerTable } from "./TrackerTable";
import { StatusSummary } from "./StatusSummary";
import { TrackerStatTilesStrip } from "./StatTilesStrip";
import { TrackerHealthCallout } from "./TrackerHealthCallout";

/**
 * Tracker page — V4 §2 "Tracker — master sheet preview" re-port.
 * Uses V4's `.section` + `.section-head` + `.section-title` +
 * `.section-sub` + `.section-link` classes directly so the outer
 * chrome matches the mockup by construction.
 *
 * The layout below the head mirrors V4 lines 1798–1869:
 *   - `.approval-col` wrapping the `.sheet-head-strip` + table (inside TrackerTable)
 *   - `.walk-callout` yellow dashed footer strip (in TrackerHealthCallout)
 *
 * Auxiliary components that sit between the section head and the grid —
 * `TrackerStatTilesStrip` + `StatusSummary` — are left in place; they
 * are ours (not in V4) but don't conflict with the V4 chrome.
 *
 * Force dynamic: search params must not be cached across navigations.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { c } = await searchParams;

  const campaigns = await listActiveCampaigns();
  const campaignId = resolveCurrentCampaignId(campaigns, c);

  // No campaigns at all — usually means unauthenticated. The layout
  // switcher already surfaces a copy-level explanation; we echo it here.
  if (!campaignId) {
    return (
      <div className="mx-auto max-w-2xl rounded-[10px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
        <h1 className="mb-2 text-lg font-semibold text-text">
          No campaigns available
        </h1>
        <p className="text-[13px] text-text-dim">
          Sign in to load your tracker. Row-level security gates every
          table until an authenticated session is present.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
        >
          Go to sign-in
        </Link>
      </div>
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const rows = await getTrackerRows(campaignId);

  return (
    <section id="tracker" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` (line 1800) — title on the left, "Open master
          sheet" link on the right. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Tracker — master sheet preview
            {activeCampaign ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · "}
                {activeCampaign.name}
              </span>
            ) : null}
          </div>
          <div className="section-sub">
            The 16-code status vocabulary is live.{" "}
            <code
              style={{
                fontFamily: "'SF Mono', monospace",
                fontSize: 11,
                background: "var(--surface-alt)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              Days since
            </code>{" "}
            derived on read. Commentary uses{" "}
            <code
              style={{
                fontFamily: "'SF Mono', monospace",
                fontSize: 11,
                background: "var(--surface-alt)",
                padding: "1px 5px",
                borderRadius: 3,
              }}
            >
              [YYYY-MM-DD]
            </code>{" "}
            prefix with ` | ` separator; newest appended.
          </div>
        </div>
        <span className="section-link">Open master sheet ↗</span>
      </div>

      {/* Stat-tiles strip — 4 aggregate counts computed live from rows. */}
      <TrackerStatTilesStrip rows={rows} />

      {rows.length === 0 ? (
        <EmptyState campaignName={activeCampaign?.name ?? ""} />
      ) : (
        <>
          <StatusSummary rows={rows} />
          <TrackerTable
            rows={rows}
            campaignName={activeCampaign?.name}
          />
          <TrackerHealthCallout />
        </>
      )}
    </section>
  );
}

/**
 * Empty-state card. Shown when the mirrors haven't been populated yet
 * (or the selected campaign has no partners assigned). Deliberately
 * not a spinner — this is the genuine state in V1, not a loading blip.
 */
function EmptyState({ campaignName }: { campaignName: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-light text-accent">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h2 className="mb-1.5 text-[14px] font-semibold text-text">
        No partners yet
      </h2>
      <p className="mx-auto max-w-md text-[12px] leading-relaxed text-text-dim">
        The nightly sync runs at 06:00 BST and populates partners from
        the local Forge Capital pipeline.
        {campaignName ? (
          <>
            {" "}
            Viewing{" "}
            <span className="font-medium text-text">{campaignName}</span>.
          </>
        ) : null}{" "}
        If this looks wrong, use the campaign switcher above to confirm
        you are on the right campaign.
      </p>
      <div className="mt-4 text-[11px] text-text-faint">
        Last-synced timestamps appear on each row once data lands.
      </div>
    </div>
  );
}
