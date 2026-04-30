import { cookies } from "next/headers";
import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import { generateWeeklyDigest } from "./actions";
import { SendDigestButton } from "./SendDigestButton";

/**
 * /weekly-digest — manual preview page for the Monday 07:00 BST founder
 * digest. Shows the generated plain-text body for the active campaign
 * plus a "Send to me now" button that dispatches via Gmail.
 *
 * V4 class vocabulary reused where applicable (`.section`,
 * `.section-head`, `.section-title`, `.section-sub`) so the chrome
 * stays visually part of the app — the digest itself renders in a
 * monospace pre block because it is a plain-text email, faithfulness
 * to the on-the-wire bytes matters more than pretty HTML typography
 * here.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function WeeklyDigestPage({
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
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Weekly founder digest</div>
            <div className="section-sub">
              Select a campaign from the top-bar switcher to preview its
              Monday 07:00 BST digest.
            </div>
          </div>
        </div>
      </section>
    );
  }

  const digest = await generateWeeklyDigest({ campaignId });

  if (!digest.ok) {
    return (
      <section className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Weekly founder digest</div>
            <div className="section-sub">
              Could not generate the digest: {digest.error}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const activeCampaign = campaigns.find((x) => x.id === campaignId);

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-title">Weekly founder digest</div>
          <div className="section-sub">
            Plain-text summary of the last 7 days on{" "}
            <b>{activeCampaign?.name ?? "this campaign"}</b>. Delivered
            automatically every Monday at 07:00 BST once the launchd
            plist in <code>ops/launchd/</code> is installed. Click{" "}
            <b>Send to me now</b> to dispatch the email below right now.
          </div>
        </div>
        <Link href="/pipeline#weekly" className="section-link">
          Back to pipeline &rarr;
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: 12,
          margin: "16px 0",
        }}
      >
        <Tile label="Sent" value={digest.stats.sent} />
        <Tile
          label="Replies"
          value={digest.stats.replies}
          sub={`${digest.stats.repliesPositive}+ / ${digest.stats.repliesNegative}-`}
        />
        <Tile label="Meetings" value={digest.stats.meetings_booked} />
        <Tile label="Silent >7d" value={digest.stats.silent_over_7d} />
        <Tile label="Handovers" value={digest.stats.handovers} />
        <Tile label="Declines" value={digest.stats.declines} />
      </div>

      <div
        style={{
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          padding: 20,
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Subject
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {digest.subject}
            </div>
          </div>
          <SendDigestButton campaignId={campaignId} />
        </div>

        <pre
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            fontFamily:
              "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text)",
          }}
        >
          {digest.body}
        </pre>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "var(--accent)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginTop: 6,
        }}
      >
        {label}
      </div>
      {sub ? (
        <div
          style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
