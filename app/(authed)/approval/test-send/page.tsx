import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getPendingApproval } from "@/lib/queries/approval";
import { TestBatchPanel } from "./TestBatchPanel";

/**
 * Test-send surface — route for drafting and dispatching the first N
 * pending-approval rows as an email batch to a **test** address
 * (typically the founder's mac.com inbox) so they can eyeball the full
 * rendered email BEFORE any real investor receives it. Each send:
 *
 *   - Rewrites the `To` header to the test address.
 *   - Prefixes the subject with [TEST].
 *   - Appends a one-line test banner to the bottom of the body so the
 *     recipient (the founder) sees it's a dry run.
 *   - Logs to contact_events with `kind = test_send` so the live
 *     tracker row status (+0 Pending approval etc.) is NOT advanced.
 *
 * This is intentionally distinct from the Send-via-Gmail flow on the
 * per-row draft page — that one sends to the real partner address and
 * advances status. Test-send is a batch dry-run for founder review
 * before production approval.
 *
 * Built 2026-04-23 in response to: "draft the emails and send 20 of
 * them — but to my mac.com address. i can then see them. mark them
 * as test."
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function TestSendPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { c } = await searchParams;
  const campaigns = await listActiveCampaigns();
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);

  if (!campaignId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-[20px] font-semibold text-text">
          No campaign selected
        </h1>
        <p className="mt-2 text-[13px] text-text-dim">
          Pick a campaign from the top-bar switcher to see pending-approval
          rows.
        </p>
      </main>
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const pendingRows = await getPendingApproval(campaignId);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-4 text-[12px] text-text-dim">
        <Link
          href="/approval"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          &larr; Back to approval
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Test batch &mdash; send to a review inbox before any real send
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
          Picks up to 20 pending-approval rows from the active campaign,
          drafts each through the shared composer (credibility + company +
          per-investor synthesis + CTA), and sends each one to the test
          address you supply. Subjects are prefixed <code>[TEST]</code>.
          A one-line banner is appended to the body. The live tracker row
          status is not advanced — these are dry runs.
        </p>
      </header>

      <section className="mb-4 rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <div className="text-[12px] text-text-dim">
          <b className="text-text">Campaign</b>:{" "}
          {activeCampaign?.name ?? "Untitled"}
        </div>
        <div className="mt-1 text-[12px] text-text-dim">
          <b className="text-text">Rows at +0 Pending approval</b>:{" "}
          {pendingRows.length}
        </div>
      </section>

      <TestBatchPanel
        campaignId={campaignId}
        campaignName={activeCampaign?.name ?? "Campaign"}
        pendingCount={pendingRows.length}
        previewRows={pendingRows.slice(0, 5).map((r) => ({
          firmName: r.firm_name,
          partnerName: r.partner_name,
        }))}
      />
    </main>
  );
}
