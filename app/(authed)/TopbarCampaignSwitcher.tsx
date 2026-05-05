"use client";

import { usePathname } from "next/navigation";
import { CampaignDropdown } from "./CampaignDropdown";
import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * Campaign switcher wrapper — hides on /discover (which is campaign-agnostic).
 * The Discovery page is pure research; campaign controls belong on /pipeline.
 */
export function TopbarCampaignSwitcher({
  campaigns,
  activeCampaignId,
  totalActive,
}: {
  campaigns: CampaignSummary[];
  activeCampaignId: string | null;
  totalActive: number;
}) {
  const pathname = usePathname() ?? "";
  const onDiscover = pathname === "/discover";

  // Discovery page is campaign-agnostic — no switcher
  if (onDiscover) return null;

  return (
    <>
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

      {/* "+" new-campaign button */}
      <button
        type="button"
        className="new-camp-btn"
        title="New campaign"
        aria-label="New campaign"
      >
        +
      </button>
    </>
  );
}
