import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import {
  getTrackerRows,
  isTrackerTierFilter,
  type TrackerTierFilter,
} from "@/lib/queries/tracker";
import { getTrackerActionPanel } from "@/lib/queries/tracker-action-panel";
import { TrackerTable } from "./TrackerTable";
import { StatusSummary } from "./StatusSummary";
import { TrackerActionPanel } from "./TrackerActionPanel";
import { TrackerHealthCallout } from "./TrackerHealthCallout";
import { TrackerDropZone } from "./TrackerDropZone";
import { StageBanner } from "../StageBanner";

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

type SearchParams = Promise<{ c?: string; tier?: string }>;

export default async function TrackerPage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /tracker — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c, tier } = await searchParams;

  // Deliverability-tier deep-link (?tier=corresponded|hunter_verified|
  // unverified|generic_blocked|bounced) — used by the verification gate
  // buttons to jump straight to the affected subset. Unknown values fall
  // through to the unfiltered view so a typo in a hand-crafted URL still
  // renders a useful page.
  const tierFilter: TrackerTierFilter | null = isTrackerTierFilter(tier)
    ? tier
    : null;

  let campaigns: CampaignSummary[];
  let campaignId: string | null;
  if (initialCampaigns !== undefined) {
    campaigns = initialCampaigns;
    campaignId = initialCampaignId ?? null;
  } else {
    campaigns = await listActiveCampaigns();
    campaignId = resolveCurrentCampaignId(campaigns, c);
  }

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
  const [rows, actionPanel] = await Promise.all([
    getTrackerRows(campaignId, tierFilter),
    // UX audit 2026-04-23 item #7: the old right-side chart + stat strip
    // was static. The action panel shows Next step / Recent activity /
    // Needs attention — all decision-oriented, all real data.
    getTrackerActionPanel(campaignId),
  ]);

  return (
    <>
    <StageBanner number={7} title="Tracker" />
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
        {/* "Open master sheet" was a V4 artefact — the app IS the master
            sheet now. Removed the inert span; the Export button in the
            TrackerTable header serves the same purpose. */}
      </div>

      {/* Tier-filter banner — only renders when ?tier=... is active. Gives
          the user a visible way back to the unfiltered view; copy names
          the tier in plain English so the banner reads self-explanatory
          even when the filter arrives from a deep-link. */}
      {tierFilter ? (
        <TierFilterBanner tier={tierFilter} campaignId={campaignId} />
      ) : null}

      {/* UX audit 2026-04-23 item #7: Next-step action panel replaces
          the static stat-tiles strip. Three decision surfaces —
          pending approval count with primary CTA, recent contact
          events, and rows needing attention per the +6 / +7 / +10
          thresholds. See TrackerActionPanel.tsx for the full spec. */}
      <TrackerActionPanel campaignId={campaignId} data={actionPanel} />

      {rows.length === 0 ? (
        <EmptyState campaignName={activeCampaign?.name ?? ""} />
      ) : (
        <>
          {/* Drop-zone for pitch/email/snippet content. Sits ABOVE the
              table per the instructions-at-top rule. Client component —
              handles drag-drop, paste, and the apply-to-row modal. */}
          <TrackerDropZone rows={rows} campaignId={campaignId} />

          {/* One-time banner when NO partner has any email traffic.
              Tells Tristan the Gmail sync daemon hasn't run yet rather
              than leaving every cell silently empty. Disappears once a
              single contact_events row lands. */}
          {rows.every(
            (r) =>
              r.emails_in === 0 && r.emails_out === 0 && !r.last_event_at,
          ) ? (
            <GmailSyncPendingBanner />
          ) : null}

          <TrackerTable
            rows={rows}
            campaignName={activeCampaign?.name}
            counterpartName={activeCampaign?.counterpart_name ?? undefined}
            counterpartEmail={activeCampaign?.counterpart_email ?? null}
          />

          {/* UX audit 2026-04-23 item #7: the status-distribution strip
              moves below the grid as a smaller widget — useful context,
              not a decision surface, so no longer commands top-of-page
              real estate. */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 8,
              }}
            >
              Status distribution
            </div>
            <StatusSummary rows={rows} />
          </div>

          <TrackerHealthCallout />
        </>
      )}
    </section>
    </>
  );
}

/**
 * Shown when every campaign_partner_id has zero contact_events — i.e.
 * the Gmail sync job hasn't populated any traffic yet. Placed ABOVE the
 * table so it's seen before the per-row "no email traffic yet" copy.
 * Once a single contact_events row lands, the banner disappears.
 *
 * Tone: explanatory, not apologetic — the daemon is known-pending work
 * (it's being built in parallel as the `com.forgecapital.gmail-sync`
 * launchd job). Empty-state copy is product copy, not filler.
 */
function GmailSyncPendingBanner() {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--surface-alt)",
        border: "1px dashed var(--border)",
        fontSize: 12,
        color: "var(--text-dim)",
        lineHeight: 1.55,
      }}
    >
      <b style={{ color: "var(--text)" }}>Gmail sync hasn&apos;t run yet</b> —
      inbound/outbound events populate once the new{" "}
      <code
        style={{
          fontFamily: "'SF Mono', monospace",
          fontSize: 11,
          background: "var(--surface)",
          padding: "1px 6px",
          borderRadius: 3,
          border: "1px solid var(--border)",
        }}
      >
        com.forgecapital.gmail-sync
      </code>{" "}
      job lands. Each row shows{" "}
      <span style={{ fontStyle: "italic", color: "var(--text-faint)" }}>
        &quot;no email traffic yet&quot;
      </span>{" "}
      until then.
    </div>
  );
}

/** Short human label for each deliverability tier. Kept in-file so the
 *  banner renders without a module hop; the 5-tier taxonomy is
 *  canonicalised in `lib/queries/tracker.ts`. */
const TIER_LABEL: Record<TrackerTierFilter, string> = {
  corresponded: "Corresponded",
  hunter_verified: "Hunter-verified",
  neverbounce_valid: "NeverBounce valid",
  neverbounce_catchall: "NeverBounce catch-all",
  neverbounce_unknown: "NeverBounce unknown",
  unverified: "Unverified",
  generic_blocked: "Generic inbox blocked",
  neverbounce_invalid: "NeverBounce invalid",
  neverbounce_disposable: "NeverBounce disposable",
  bounced: "Bounced",
};

/**
 * Shown at the top of the tracker when a `?tier=` deep-link is active.
 * Renders the current filter in plain English with a "Clear filter"
 * link that drops the query param but keeps the campaign selection.
 */
function TierFilterBanner({
  tier,
  campaignId,
}: {
  tier: TrackerTierFilter;
  campaignId: string;
}) {
  return (
    <div
      role="status"
      style={{
        margin: "0 0 12px 0",
        padding: "10px 14px",
        background: "var(--accent-light, #eef2ff)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--text-dim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span>
        Filtered to <b>{TIER_LABEL[tier]}</b> partners. Source:
        verification gate.
      </span>
      <Link
        href={`/tracker?c=${campaignId}`}
        style={{ color: "var(--accent)", textDecoration: "underline dotted" }}
      >
        Clear filter
      </Link>
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
