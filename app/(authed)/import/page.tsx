import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { ImportTrackerClient } from "./ImportTrackerClient";

/**
 * Tracker ingest page — drop your xlsx tracker (the one Claude
 * Co-work has been writing to) and we'll pull the status/commentary
 * into the active campaign. Preview-first; nothing writes until you
 * confirm.
 *
 * Exists outside the V4 section structure (no topbar pill) because
 * it's a founder-maintenance action, not a part of the daily flow.
 * Reachable from the topbar "Import tracker ↑" link.
 */
export const dynamic = "force-dynamic";

export default async function ImportTrackerPage() {
  const campaigns = await listActiveCampaigns();
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId = resolveCurrentCampaignId(campaigns, cookieCampaign);
  const active = campaigns.find((c) => c.id === campaignId) ?? null;

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">Import tracker spreadsheet</div>
          <div className="section-sub">
            Drop your latest tracker xlsx (the one Claude Co-work writes to).
            We parse it, match firms against the investor pool, and preview
            what would land on <b>{active?.name ?? "the active campaign"}</b>{" "}
            before anything gets written. Use the campaign switcher in the top
            bar to change the target.
          </div>
        </div>
      </div>

      {active ? (
        <ImportTrackerClient
          campaignId={active.id}
          campaignName={active.name}
        />
      ) : (
        <div
          style={{
            padding: "30px 22px",
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: 13,
          }}
        >
          Pick a campaign from the top-bar switcher before importing a tracker.
        </div>
      )}
    </section>
  );
}
