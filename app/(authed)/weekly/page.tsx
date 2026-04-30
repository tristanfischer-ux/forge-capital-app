import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import { getWeeklySummary } from "@/lib/queries/weekly";
import { PipelineVolumeChart, StatusDistributionChart } from "./WeeklyCharts";
import { WeeklyFooter } from "./WeeklyFooter";

/**
 * Weekly counterpart update — V4 §10 port (Phase2-Mockup-V4.html
 * lines 1872-2175).
 *
 * Renders the weekly digest that Tristan sends to the counterpart
 * (investor founder for investor campaigns, buyer principal for
 * customer campaigns) every Friday. V1 scope per V4-FEEDBACK-ROUND-2:
 * NO auto-send — the Send button only previews what WILL be sent.
 *
 * V4 class names used verbatim (all live in app/v4-mockup.css):
 *   - `.section` / `.section-head` / `.section-title` / `.section-sub`
 *   - `.weekly-wrap`
 *   - `.weekly-head` / `.wh-title` / `.wh-sub` / `.wh-to`
 *   - `.weekly-grid-stats` / `.wk-stat` / `.n` / `.l` / `.delta`
 *   - `.weekly-charts` / `.chart-card` / `.chart-head` / `.chart-title`
 *     / `.chart-legend` / `.leg-item` / `.leg-dot` / `.chart-svg`
 *   - `.weekly-callout` / `.wc-card` / `.wc-head` / `.wc-ico` /
 *     `.wc-title` / `.wc-list` / `.wc-item` / `.wc-firm` / `.wc-sep`
 *   - `.weekly-foot` / `.wf-spacer`
 *   - `.btn` / `.btn.primary`
 *   - `.walk-callout` / `.wc-num`
 *
 * Force dynamic: campaign resolution reads the `fc_active_campaign`
 * cookie; default caching would otherwise pin the first-requested
 * campaign across users.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function WeeklyPage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /weekly — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c } = await searchParams;

  let campaigns: CampaignSummary[];
  let campaignId: string | null;
  if (initialCampaigns !== undefined) {
    campaigns = initialCampaigns;
    campaignId = initialCampaignId ?? null;
  } else {
    campaigns = await listActiveCampaigns();
    const cookieStore = await cookies();
    const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
    campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);
  }

  if (!campaignId) {
    return <NoCampaignState />;
  }

  const summary = await getWeeklySummary(campaignId);
  if (!summary) {
    return (
      <section id="weekly" className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">
              Weekly counterpart update{" "}
              <span className="new-tag">NEW CHARTS</span>
            </div>
            <div className="section-sub">
              Could not load the weekly summary for this campaign &mdash;
              the campaigns row may have been archived or RLS denied the
              read.
            </div>
          </div>
        </div>
      </section>
    );
  }

  const counterpartLabel =
    summary.counterpartName ?? "Counterpart TBD";
  const counterpartAddrLabel = summary.counterpartEmail ?? "email address not yet set";
  const intentLabel =
    summary.campaignIntent === "customer"
      ? "buyer pipeline update"
      : summary.campaignIntent === "supplier"
        ? "supplier pipeline update"
        : "fundraise update";

  // 2026-04-22: dropped "Week N of M" — Tristan flagged it as not
  // useful. Header is now just the campaign name + intent. The ISO
  // calendar week number is kept as a subtle timestamp on the
  // generated line for reference, nothing more.
  // UX audit 2026-04-23 item #2: the weekly digest header goes to the
  // counterpart, so render the user-facing `campaignDisplayName`
  // (migration 027) — never the internal "AUDIT · …" tracker token.
  const weekHeading = `${summary.campaignDisplayName} · ${intentLabel}`;

  const generatedHuman = formatGeneratedLabel(summary.generatedAt);

  return (
    <section id="weekly" className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">
            Weekly counterpart update{" "}
            <span className="new-tag">NEW CHARTS</span>
          </div>
          <div className="section-sub">
            The weekly composer runs Fri 17:00 BST and writes a draft —{" "}
            <b>nothing is sent without your review.</b> Once Gmail is
            connected (done), drafts land in your Drafts folder; until then
            they&rsquo;re saved as <code>.txt</code> files under{" "}
            <code>~/.forge-capital/weekly-drafts/</code>. Charts render
            inline. One template shape varies by campaign intent.
          </div>
        </div>
        <Link
          href={`/weekly-digest?c=${campaignId}`}
          className="section-link"
          title="Weekly founder digest (Monday 07:00 BST). Previews the plain-text summary and lets you self-send."
        >
          Preview founder digest &rarr;
        </Link>
      </div>

      <div className="weekly-wrap">
        {/* ---- Weekly head ---- */}
        <div className="weekly-head">
          <div>
            <div className="wh-title">{weekHeading}</div>
            <div className="wh-sub">
              Activity in the last 7 days &middot; generated {generatedHuman}
            </div>
          </div>
          <div className="wh-to">
            To: <b>{counterpartLabel}</b>{" "}
            <span
              title="V1 has no campaigns.counterpart_name / counterpart_email column. Wires up when the campaigns schema is extended."
              style={{ color: "var(--text-faint)" }}
            >
              &lt;{counterpartAddrLabel}&gt;
            </span>
            <br />
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              sent automatically every Friday once Send is clicked
            </span>
          </div>
        </div>

        {/* ---- Stat tiles ---- */}
        <div
          className="weekly-grid-stats"
          style={{
            gridTemplateColumns: `repeat(${summary.tiles.length}, minmax(0, 1fr))`,
          }}
        >
          {summary.tiles.map((t) => (
            <div key={t.id} className="wk-stat">
              <div className={toneClass(t.tone)}>{t.value}</div>
              <div className="l">{t.label}</div>
              {t.delta ? (
                <div className={deltaClass(t.delta.direction)}>
                  {deltaGlyph(t.delta.direction)}{" "}
                  <span>{t.delta.label}</span>
                </div>
              ) : (
                <div className="delta" style={{ color: "var(--text-faint)" }}>
                  no prior activity
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ---- Charts ---- */}
        <div className="weekly-charts">
          <PipelineVolumeChart
            points={summary.pipelinePoints}
            hasData={summary.hasEventData}
          />
          <StatusDistributionChart distribution={summary.distribution} />
        </div>

        {/* ---- Callouts ---- */}
        <div className="weekly-callout">
          <div className="wc-card green">
            <div className="wc-head green">
              <span className="wc-ico">&#9733;</span>
              <span className="wc-title">
                {summary.campaignIntent === "customer"
                  ? "Top conversations this week"
                  : "Top 3 conversations this week"}
              </span>
            </div>
            <div className="wc-list">
              {summary.topConversations.length === 0 ? (
                <div
                  className="wc-item"
                  style={{ color: "var(--text-faint)", fontStyle: "italic" }}
                >
                  No conversations with recorded activity yet &mdash; the
                  list fills as partners move through the pipeline.
                </div>
              ) : (
                summary.topConversations.map((conv) => {
                  const firm = conv.firmName ?? "(unknown firm)";
                  const status = conv.statusLabel
                    ? `${conv.statusCode} ${conv.statusLabel}`
                    : conv.statusCode ?? "no status";
                  const touch =
                    conv.daysSinceLastTouch === null
                      ? "no touch logged"
                      : conv.daysSinceLastTouch === 0
                        ? "contacted today"
                        : `${conv.daysSinceLastTouch}d since last touch`;
                  return (
                    <div key={conv.partnerId} className="wc-item">
                      <span className="wc-firm">{firm}</span>
                      {conv.partnerName ? ` (${conv.partnerName})` : ""}{" "}
                      &middot; {status}
                      <span className="wc-sep">|</span>
                      {touch}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="wc-card amber">
            <div className="wc-head amber">
              <span className="wc-ico">!</span>
              <span className="wc-title">
                {summary.callouts.length === 0
                  ? "No items needing your steer"
                  : `${summary.callouts.length} item${
                      summary.callouts.length === 1 ? "" : "s"
                    } needing your steer`}
              </span>
            </div>
            <div className="wc-list">
              {summary.callouts.length === 0 ? (
                <div
                  className="wc-item"
                  style={{ color: "var(--text-faint)", fontStyle: "italic" }}
                >
                  Nothing bounced, nothing stale past 10 days. We&rsquo;ll
                  flag bounces, stale follow-ups, and gate-blocked partners
                  here as they surface.
                </div>
              ) : (
                summary.callouts.map((c) => (
                  <div key={c.partnerId} className="wc-item">
                    <span className="wc-firm">
                      {c.firmName ?? "(unknown firm)"}
                    </span>{" "}
                    &middot; {c.reason}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ---- Footer ---- */}
        <WeeklyFooter
          campaignId={campaignId}
          counterpartName={summary.counterpartName}
          counterpartEmail={summary.counterpartEmail}
        />
      </div>

      {/* V4 walk-callout tour strip — verbatim from V4 line 2174. */}
      <div className="walk-callout">
        <span className="wc-num">6</span>
        <b>This is the centrepiece Tristan asked for.</b> Every Friday at
        17:00 the system writes this email, renders the charts inline (no
        attachment), queues it as a Gmail draft. Tristan opens it,
        glances, hits Send. Total weekly counterpart-update cost: 90
        seconds.
      </div>
    </section>
  );
}

/**
 * Friendly "Fri 24 Apr 17:00 BST" label matching V4 style. Falls back
 * to the raw ISO if Intl formatting fails (should never happen in
 * Node 22 but the fallback keeps the surface honest).
 */
function formatGeneratedLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
      timeZoneName: "short",
    });
    return fmt.format(d);
  } catch {
    return iso;
  }
}

function toneClass(tone: "accent" | "green" | "red" | undefined): string {
  if (tone === "accent") return "n accent";
  if (tone === "green") return "n green";
  if (tone === "red") return "n red";
  return "n";
}

function deltaClass(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "delta up";
  if (dir === "down") return "delta down";
  return "delta";
}

function deltaGlyph(dir: "up" | "down" | "flat"): string {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  return "";
}

function NoCampaignState() {
  return (
    <section id="weekly" className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">
            Weekly counterpart update{" "}
            <span className="new-tag">NEW CHARTS</span>
          </div>
          <div className="section-sub">
            Sign in to load your weekly digest. Row-level security gates
            every campaigns row until an authenticated session is
            present.
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
