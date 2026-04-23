import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { getPendingApproval } from "@/lib/queries/approval";
import { ScheduleBatchPanel } from "./ScheduleBatchPanel";

/**
 * Schedule-send surface — queues a batch of scheduled-dispatch rows
 * so they arrive in the recipient's local morning window rather than
 * hitting Gmail in a single burst.
 *
 * Per partner: the HQ string is mapped to an IANA timezone, a random
 * local time within [start, end) is jittered, and the UTC instant is
 * written to `scheduled_sends`. The dispatcher daemon
 * (`scripts/scheduled-sends-dispatcher.mjs`) polls every 60 seconds
 * and sends due rows via Gmail.
 *
 * Design doc: docs/design-scheduled-sends.md.
 *
 * Note: this page runs `composeDraft` + Opus refinement for each row
 * during queue time (same as /approval/test-send). If a row has no
 * cached synthesis it's refined on the spot — adds 3-5s per row.
 * Batches of 20 take ~60-100s at worst.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

/** Return the next weekday (Mon-Fri) as an ISO yyyy-mm-dd string. */
function defaultTargetDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function ScheduleSendPage({
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
          Pick a campaign from the top-bar switcher to queue a scheduled batch.
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
        {" · "}
        <Link
          href="/approval/scheduled"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          See scheduled queue &rarr;
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Schedule batch &mdash; dispatch staggered across the recipient&apos;s
          local morning
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
          Queues up to 20 pending-approval rows into{" "}
          <code>scheduled_sends</code>. Each partner&apos;s timezone is
          inferred from their <code>hq_location</code> (Helsinki, Stockholm,
          Oslo, Copenhagen, Toronto, Vancouver, etc.). A random time inside
          the local window is chosen per row so sends don&apos;t cluster on
          the minute. The dispatcher daemon polls every 60&nbsp;seconds and
          dispatches due rows via Gmail. Unmatched HQ strings fall back to
          the UTC wall-clock of the same window.
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

      <ScheduleBatchPanel
        campaignId={campaignId}
        campaignName={activeCampaign?.name ?? "Campaign"}
        pendingCount={pendingRows.length}
        defaultTargetDate={defaultTargetDate()}
        previewRows={pendingRows.slice(0, 5).map((r) => ({
          firmName: r.firm_name,
          hqLocation: r.hq_location,
        }))}
      />
    </main>
  );
}
