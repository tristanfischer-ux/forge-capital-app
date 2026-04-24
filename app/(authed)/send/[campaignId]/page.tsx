import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { listCustomerCampaignPartners } from "@/lib/queries/customer-partners";
import { getCampaignMonitor } from "@/lib/queries/monitor";
import { SendFlow } from "./SendFlow";

/**
 * /send/[campaignId] — the 9-step linear customer-outreach flow.
 *
 * Tristan 2026-04-24 (canonical spec):
 *   Step 1 — Customer brief
 *   Step 2 — Hunting criteria (who we're looking for)
 *   Step 3 — Search for customers
 *   Step 4 — Pick customers (tick to select)
 *   Step 5 — Email resolution (available → continue, missing → Hunter)
 *   Step 6 — Template (Opus-assisted, Tristan-editable)
 *   Step 7 — Draft all selected
 *   Step 8 — Approve batch
 *   Step 9 — Queue + final review + send + monitor
 *
 * This route is the PRIMARY working surface for self-managed campaigns
 * (Fischer Farms Customer, SkySails Power, Panatere, ForgeOS). The
 * pre-existing /approval + /tracker surfaces stay as views-of-the-data;
 * /send is the action surface. Linear Prev/Next with state persistence
 * so a refresh doesn't lose progress.
 *
 * Self-managed guard: if the campaign has a counterpart_email set, this
 * route redirects to /approval (the 3-party flow) — the /send linear
 * flow is wrong-shaped for campaigns that need an external approver.
 */
export const dynamic = "force-dynamic";

export default async function SendPage(props: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await props.params;
  if (!campaignId) notFound();

  const supabase = await createServerClient();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select(
      "id, name, display_name, campaign_intent, status, counterpart_email, counterpart_name, company_description, hunting_criteria, customer_template",
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (error) {
    console.error("SendPage campaign fetch failed:", error.message);
    notFound();
  }
  if (!campaign) notFound();

  // Multi-party campaigns (with a counterpart_email set — e.g.
  // FishFrom's Andrew Robertson) flow through the SAME /send route
  // but trigger the 4a/4b/4c permission block between Pick and Email.
  // Previous revision redirected them to /approval — we keep /send as
  // the unified surface now so the flow is one mental model regardless.
  const counterpartEmail =
    typeof campaign.counterpart_email === "string" &&
    campaign.counterpart_email.trim().length > 0
      ? campaign.counterpart_email.trim()
      : null;

  // Load everything the flow needs up-front. Steps 3/4 use the customer
  // list; Step 5 reads email state off each row; Step 7 reads drafts
  // from rendered_synthesis (if cached); Step 10 reads the monitor
  // view (scheduled_sends + contact_events). Campaign-scoped so RLS
  // keeps the query tight.
  const [customerPartners, monitor] = await Promise.all([
    listCustomerCampaignPartners(campaignId),
    getCampaignMonitor(campaignId),
  ]);

  return (
    <SendFlow
      campaignId={campaign.id}
      campaignName={campaign.display_name ?? campaign.name ?? "this campaign"}
      initialBrief={campaign.company_description ?? ""}
      initialCriteria={campaign.hunting_criteria ?? ""}
      initialTemplate={campaign.customer_template ?? ""}
      customerPartners={customerPartners}
      counterpartEmail={counterpartEmail}
      monitor={monitor}
    />
  );
}
