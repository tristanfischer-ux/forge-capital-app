import { getCrossCampaignInvestors } from "@/lib/queries/cross-campaign-investors";
import { listActiveCampaigns } from "@/lib/queries/campaigns";
import InvestorsPageClient from "./InvestorsPageClient";

export const dynamic = "force-dynamic";

/**
 * Cross-campaign Master Investor Tracker — web equivalent of the Excel spreadsheet.
 * Shows every investor Tristan has ever reached out to, across all campaigns.
 * Separate from the per-campaign Pipeline/Tracker page.
 */
export default async function InvestorsPage() {
  const investors = await getCrossCampaignInvestors();
  const campaigns = await listActiveCampaigns();
  const campaignNames = campaigns.map((c) => c.name);

  return <InvestorsPageClient investors={investors} campaignNames={campaignNames} />;
}
