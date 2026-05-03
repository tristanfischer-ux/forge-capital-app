import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";

import ApprovalPage from "../approval/page";
import AutomationPage from "../automation/page";
import TemplatesPage from "../templates/page";
import ReviewPage from "../review/page";
import DraftsPage from "../drafts/page";
import TrackerPage from "../tracker/page";
import WeeklyPage from "../weekly/page";
import InboxPage from "../inbox/page";
import ImportTrackerPage from "../import/page";
import { GoogleConnectionStatus } from "../GoogleConnectionStatus";
import { StageBanner } from "../StageBanner";
import { ApprovalExcelButtons } from "./ApprovalExcelButtons";

/**
 * Pipeline page — the "personal database" surface.
 *
 * Everything here is campaign-scoped: the campaign switcher lives in
 * the layout topbar, and every section reads the active campaign from
 * ?c= or the fc_active_campaign cookie. This page contains:
 *
 *   2. Approval        — two-way approval queue
 *   3. Automation       — launchd pipeline health dashboard
 *   4. Templates        — email template library
 *   5. Review           — eyeball review queue
 *   6. Drafts           — Gmail draft management
 *   7. Tracker          — master outreach tracker
 *   8. Weekly           — weekly update / stats
 *   9. Gmail + Calendar — Google connection status
 *  10. Import tracker   — bulk import
 *  11. Inbox            — reply management
 *
 * Discovery (Find a Match) lives on /discover — the truth database
 * page. Results flow from /discover → /pipeline via the "Add to
 * campaign" bridge.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  c?: string;
  a?: string;
}>;

export default async function PipelinePage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  initialCampaigns?: Awaited<ReturnType<typeof listActiveCampaigns>>;
  initialCampaignId?: string;
}) {
  const params = await searchParams;

  const campaigns = initialCampaigns ?? (await listActiveCampaigns());
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId =
    initialCampaignId ??
    resolveCurrentCampaignId(campaigns, params.c ?? cookieCampaign);

  if (!campaignId) {
    return <NoCampaignsState />;
  }

  return (
    <>
      <StageBanner number={2} title="My Pipeline" />

      {/* ──────────────── Approval ──────────────── */}
      <div id="approval">
        <Suspense
          key={`approval-${campaignId}`}
          fallback={<SectionSkeleton label="Approval" height={480} />}
        >
          <ApprovalPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
        <section className="section" style={{ marginTop: 0, paddingTop: 0 }}>
          <ApprovalExcelButtons
            campaignId={campaignId}
            campaignName={
              campaigns.find((c) => c.id === campaignId)?.name ?? ""
            }
          />
        </section>
      </div>

      {/* ──────────────── Automation pipeline ──────────────── */}
      <div id="automation">
        <Suspense
          key={`automation-${campaignId}`}
          fallback={<SectionSkeleton label="Automation pipeline" height={320} />}
        >
          <AutomationPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
      </div>

      {/* ──────────────── Templates ──────────────── */}
      <div id="templates">
        <Suspense
          key={`templates-${campaignId}`}
          fallback={<SectionSkeleton label="Templates" height={260} />}
        >
          <TemplatesPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
      </div>

      {/* ──────────────── Eyeball review ──────────────── */}
      <div id="review">
        <Suspense
          key={`review-${campaignId}`}
          fallback={<SectionSkeleton label="Review" height={380} />}
        >
          <ReviewPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
      </div>

      {/* ──────────────── Drafts ──────────────── */}
      <div id="drafts">
        <Suspense fallback={<SectionSkeleton label="Drafts" height={260} />}>
          <DraftsPage />
        </Suspense>
      </div>

      {/* ──────────────── Tracker ──────────────── */}
      <div id="tracker">
        <Suspense
          key={`tracker-${campaignId}`}
          fallback={<SectionSkeleton label="Tracker" height={520} />}
        >
          <TrackerPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
      </div>

      {/* ──────────────── Weekly ──────────────── */}
      <div id="weekly">
        <Suspense
          key={`weekly-${campaignId}`}
          fallback={<SectionSkeleton label="Weekly" height={460} />}
        >
          <WeeklyPage
            searchParams={searchParams}
            initialCampaigns={campaigns}
            initialCampaignId={campaignId}
          />
        </Suspense>
      </div>

      {/* ──────────────── Gmail + Calendar ──────────────── */}
      <div id="gmail-calendar">
        <StageBanner number={9} title="Gmail + Calendar" />
        <section className="section" style={{ padding: "24px 0" }}>
          <GoogleConnectionStatus />
        </section>
      </div>

      {/* ──────────────── Import tracker ──────────────── */}
      <div id="import-tracker">
        <Suspense
          fallback={<SectionSkeleton label="Import tracker" height={320} />}
        >
          <ImportTrackerPage />
        </Suspense>
      </div>

      {/* ──────────────── Inbox ──────────────── */}
      <div id="inbox">
        <Suspense fallback={<SectionSkeleton label="Inbox" height={380} />}>
          <InboxPage />
        </Suspense>
      </div>
    </>
  );
}

function NoCampaignsState() {
  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 640,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 32,
        textAlign: "center",
        boxShadow: "var(--shadow)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
        No campaigns available
      </h1>
      <p
        style={{
          marginTop: 8,
          fontSize: 13,
          color: "var(--text-dim)",
          lineHeight: 1.55,
        }}
      >
        Sign in to load your pipeline. Row-level security gates every
        table until an authenticated session is present.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex items-center rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
        style={{ marginTop: 20, display: "inline-block" }}
      >
        Go to sign-in
      </Link>
    </div>
  );
}

function SectionSkeleton({
  label,
  height,
}: {
  label: string;
  height: number;
}) {
  return (
    <section
      className="section"
      style={{
        minHeight: height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "repeating-linear-gradient(45deg, var(--surface-alt) 0 10px, var(--surface) 10px 20px)",
        border: "1px dashed var(--border)",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--text-faint)",
        }}
      >
        {label} · loading…
      </span>
    </section>
  );
}
