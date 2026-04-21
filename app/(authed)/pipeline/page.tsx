import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import {
  getPipelineLanes,
  getPipelineSummary,
  type LaneItem,
  type PipelineLane,
} from "@/lib/queries/pipeline";

/**
 * Automation pipeline — V4 §4 port (Phase2-Mockup-V4.html lines 1297-1445).
 *
 * Single section, rendered as its own route so /pipeline works as a
 * sharable deep-link. The layout chrome (topbar + sidebar) comes from
 * the authed layout; this page only emits the `<section id="automation">`
 * V4 produced, verbatim. All classes below are V4's — styling lives in
 * `app/v4-mockup.css` and is untouched here.
 *
 * Force dynamic: the sidebar reads the `fc_active_campaign` cookie;
 * Next's default caching would otherwise pin the first-requested
 * campaign for every user.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { c } = await searchParams;

  // Same campaign-resolution rule the rest of the app uses: ?c=<uuid>
  // wins, then the `fc_active_campaign` cookie, then the first active
  // campaign. The sidebar in the shell follows the cookie fallback
  // independently — this page controls only its own data.
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;

  const campaigns = await listActiveCampaigns();
  const campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);

  if (!campaignId) {
    return (
      <section id="automation" className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">
              Automation pipeline <span className="new-tag">NEW</span>
            </div>
            <div className="section-sub">
              Sign in to load your campaign pipeline.
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-2xl rounded-[10px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
          <Link
            href="/"
            className="inline-flex items-center rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
          >
            Go to sign-in
          </Link>
        </div>
      </section>
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const [lanes, summary] = await Promise.all([
    getPipelineLanes(campaignId),
    getPipelineSummary(campaignId),
  ]);

  return (
    <section id="automation" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` (line 1298) — title on the left, evidence
          chip + filter link on the right. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Automation pipeline <span className="new-tag">NEW</span>
          </div>
          <div className="section-sub">
            Every partner in every campaign, by where they sit in the flow.
            Each lane has a batch-process button &mdash; one click moves 25
            partners to the next step.
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="evidence-chip">
            <span className="dot" />
            Live across all {campaigns.length || 0} campaign
            {campaigns.length === 1 ? "" : "s"}
          </span>
          <span className="section-link">
            Campaign filter: {activeCampaign?.name ?? "—"} &rarr;
          </span>
        </div>
      </div>

      {/* V4 `.pipeline` wrapper (line 1309) contains the horizontal
          `.pipe-lanes` grid + a footer `.pipe-summary` strip. */}
      <div className="pipeline">
        <div className="pipe-lanes">
          {lanes.map((lane) => (
            <Lane key={`${lane.label}-${lane.statusCode ?? "empty"}`} lane={lane} />
          ))}
        </div>

        {/* V4 `.pipe-summary` footer (line 1435) — running tally strip
            along the bottom. Numbers come from live Supabase counts. */}
        <div className="pipe-summary">
          <b>{summary.total}</b>{" "}
          partner{summary.total === 1 ? "" : "s"} in{" "}
          {activeCampaign?.name ?? "this campaign"} &middot;{" "}
          <span>{summary.approvedPast} approved + past</span> &middot;{" "}
          <span style={{ color: "var(--amber)" }}>
            {summary.gateBlocked} blocked at a gate
          </span>{" "}
          &middot;{" "}
          <span style={{ color: "var(--green)" }}>
            {summary.replyInThisWeek} reply-in this week
          </span>
          <span
            style={{ marginLeft: "auto" }}
            title="Hard-coded in V1 — wires to cron scheduler in Phase 8"
          >
            Last batch run: <b>&mdash;</b> &middot; next auto-run Tue 09:00
          </span>
        </div>
      </div>

      {/* V4 `.walk-callout` yellow dashed footer strip (line 1444) —
          verbatim from the mockup; tour-copy, not data. */}
      <div className="walk-callout">
        <span className="wc-num">3</span>
        <b>This is the nerve centre.</b> Every partner sits in exactly one
        lane. Batch actions promote cohorts of 10&ndash;25 partners at a
        time. A human (you) only touches three lanes: the yellow flags in{" "}
        <b>OOO</b>, the reply-in lane (log conversation), and the
        reviewed-by-me lane (hit send in Gmail). The other six lanes run
        on their own.
      </div>
    </section>
  );
}

/**
 * Single `.lane` card. V4 markup (lines 1312-1325) is:
 *
 *   <div class="lane">
 *     <div class="lane-head">
 *       <div>
 *         <div class="lane-count">{count}</div>
 *         <div class="lane-label">{label}</div>
 *       </div>
 *     </div>
 *     <div class="lane-hint">{hint}</div>
 *     <div class="lane-pills">
 *       <div class="lane-pill"><span class="lp-name">…</span><span class="lp-age">…</span></div>
 *       …
 *       <div class="lane-pill"><span class="lp-name">+ N more</span><span class="lp-age"/></div>
 *     </div>
 *     <button class="lane-batch-btn">{cta}</button>
 *   </div>
 *
 * We copy that DOM exactly. Empty lanes still render the full skeleton
 * (hint + empty pills area) so the kanban grid stays visually uniform.
 */
function Lane({ lane }: { lane: PipelineLane }) {
  const countClass = lane.tone ? `lane-count ${lane.tone}` : "lane-count";
  const pillExtraClass = lane.pillClass ? ` ${lane.pillClass}` : "";

  const overflow = lane.totalMatched - lane.items.length;

  // Batch CTA className + props. `disabled` variant matches V4 by
  // using the className AND the `disabled` attribute — the mockup
  // carries both on line 1430.
  const ctaClass =
    lane.batchCtaVariant === "ghost"
      ? "lane-batch-btn ghost"
      : lane.batchCtaVariant === "disabled"
        ? "lane-batch-btn disabled"
        : "lane-batch-btn";

  return (
    <div className="lane">
      <div className="lane-head">
        <div>
          <div
            className={countClass}
            title={lane.statusLabel ? `${lane.statusCode} ${lane.statusLabel}` : undefined}
          >
            {lane.count}
          </div>
          <div className="lane-label">{lane.label}</div>
        </div>
      </div>
      <div
        className="lane-hint"
        title={lane.emptyReason ?? undefined}
      >
        {lane.hint}
      </div>
      <div className="lane-pills">
        {lane.items.length === 0 ? (
          <EmptyLanePill reason={lane.emptyReason} />
        ) : (
          <>
            {lane.items.map((item) => (
              <LanePill
                key={item.partnerId}
                item={item}
                extraClass={pillExtraClass}
              />
            ))}
            {overflow > 0 ? (
              <div className={`lane-pill${pillExtraClass}`}>
                <span className="lp-name">+ {overflow} more</span>
                <span className="lp-age" />
              </div>
            ) : null}
          </>
        )}
      </div>
      <button
        type="button"
        className={ctaClass}
        disabled={lane.batchCtaVariant === "disabled"}
        title={
          lane.batchCtaVariant === "disabled"
            ? "Batch actions land in Phase 8 — CTA shown for V4 parity"
            : "Batch actions wire up in Phase 8 — CTA shown for V4 parity"
        }
        style={{ cursor: "not-allowed", opacity: 0.85 }}
      >
        {lane.batchCta}
      </button>
    </div>
  );
}

function LanePill({
  item,
  extraClass,
}: {
  item: LaneItem;
  extraClass: string;
}) {
  const firm = item.firmName ?? "—";
  const age =
    item.daysSince === null
      ? ""
      : item.daysSince === 0
        ? "0d"
        : `${item.daysSince}d`;

  return (
    <div
      className={`lane-pill${extraClass}`}
      title={item.partnerName ? `${item.partnerName} · ${firm}` : firm}
    >
      <span className="lp-name">{firm}</span>
      <span className="lp-age">{age}</span>
    </div>
  );
}

/**
 * Placeholder pill for lanes with zero matching rows. Dashed box
 * keeps the vertical rhythm of the lane card even when there's no
 * partner to render.
 */
function EmptyLanePill({ reason }: { reason?: string }) {
  return (
    <div
      className="lane-pill"
      title={reason ?? "No partners in this lane yet"}
      style={{
        borderStyle: "dashed",
        color: "var(--text-faint)",
        justifyContent: "flex-start",
      }}
    >
      <span className="lp-name" style={{ fontStyle: "italic" }}>
        {reason ? "Lands in a later phase" : "No partners yet"}
      </span>
      <span className="lp-age" />
    </div>
  );
}
