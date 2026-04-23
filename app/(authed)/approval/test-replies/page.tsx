import Link from "next/link";
import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { loadTestReplies } from "./actions";
import { RepliesPanel } from "./RepliesPanel";

/**
 * /approval/test-replies — inbound replies to the [TEST] batch.
 *
 * For every test_send contact_event on the active campaign we fetch
 * the Gmail thread, find the latest inbound message (not from the
 * signed-in user), and surface it with Opus classification + a drafted
 * response + a single-click Send button that also updates the tracker
 * row status.
 *
 * Built 2026-04-23 so Tristan can reply to the 20 [TEST] emails from
 * his phone, then tap a button per-row to dispatch an appropriate
 * response with the right tracker transition (+7 / -1 / +5).
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function TestRepliesPage({
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
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-[20px] font-semibold text-text">
          No campaign selected
        </h1>
      </main>
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const result = await loadTestReplies({ campaignId });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-4 text-[12px] text-text-dim">
        <Link
          href="/approval"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          &larr; Back to approval
        </Link>
        {" · "}
        <Link
          href={`/approval/test-send?c=${campaignId}`}
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          Test-send batch
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Test-batch replies &mdash; classify &amp; respond
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
          Every row below is a [TEST] batch dispatch. If the recipient has
          replied (you, pretending to be an investor), the reply is parsed
          by Opus into positive / negative / neutral, a response is drafted,
          and a Send button dispatches the response AND updates the tracker
          status. Positive → <code>+7 Meeting offered</code>, negative →{" "}
          <code>-1 Declined</code>, neutral → <code>+5 Follow-up sent</code>.
        </p>
      </header>

      <section className="mb-4 rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)] text-[12px]">
        <div>
          <b className="text-text">Campaign</b>:{" "}
          {activeCampaign?.name ?? "Untitled"}
        </div>
      </section>

      {result.ok ? (
        <RepliesPanel
          rows={result.rows}
          userEmail={result.userEmail}
          campaignId={campaignId}
        />
      ) : (
        <div className="rounded-[10px] border border-red bg-red-light p-5 text-[13px] text-red">
          {result.error}
        </div>
      )}
    </main>
  );
}
