import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getTrackerRows } from "@/lib/queries/tracker";
import { TrackerTable } from "./TrackerTable";
import { StatusSummary } from "./StatusSummary";
import { SectionHead } from "../SectionHead";
import { TrackerStatTilesStrip } from "./StatTilesStrip";

/**
 * Tracker page — V1 read-only grid over `campaign_partners` joined with
 * `partners_mirror` + `investors_mirror`. Server component: fetches
 * campaigns + rows on the server, passes rows to the client TrackerTable
 * for sort/expand interactions.
 *
 * The authed layout renders the campaign switcher chip row above us and
 * picks which campaign is active via `?c=<uuid>`. When no param is set
 * we default to the first active campaign so the page isn't blank.
 *
 * The mirrors are populated by the nightly sync from Forge Capital's
 * local SQLite. Until that has run, `getTrackerRows` will return an
 * empty array — rendered as an honest empty-state card (not fake rows).
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
    <div className="space-y-5">
      <SectionHead
        title={
          <>
            Tracker
            {activeCampaign ? (
              <>
                {" "}
                <span className="text-text-dim"> — {activeCampaign.name}</span>
              </>
            ) : null}
          </>
        }
        subtitle={
          <>
            The 16-code status vocabulary is live.{" "}
            <code className="rounded-sm bg-surface-alt px-1.5 py-0.5 font-mono text-[11px]">
              Days since
            </code>{" "}
            is derived on read from the latest contact event. Two sentences
            of company + partner context under each row; why-them synthesis
            expands on row click.
          </>
        }
      />

      {/* Stat-tiles strip — 4 aggregate counts computed live from rows.
          See StatTilesStrip for the sourcing + tone rules. */}
      <TrackerStatTilesStrip rows={rows} />

      {rows.length === 0 ? (
        <EmptyState campaignName={activeCampaign?.name ?? ""} />
      ) : (
        <>
          <StatusSummary rows={rows} />
          <TrackerTable rows={rows} />
        </>
      )}
    </div>
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
