import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import {
  getVerificationCounts,
  VERIFICATION_TIER_ORDER,
  type VerificationTier,
  type VerificationTierCount,
} from "@/lib/queries/verification";

/**
 * V4 §7 Email verification gate — visualisation of the 5-tier deliverability
 * ladder for the active campaign.
 *
 * 1:1 port of Phase2-Mockup-V4.html lines 1648-1712. DOM classes come from
 * app/v4-mockup.css verbatim (`.section`, `.section-head`, `.section-title`,
 * `.section-sub`, `.section-link`, `.gate`, `.gate-head`, `.gh-icon`,
 * `.gate-why`, `.gate-row`, `.gate-firm`, `.c`, `.gate-reason`, `.gate-steps`,
 * `.gs-step`, `.gs-d`, `.gs-a`, `.gs-p`, `.gate-age`, `.tag-chip`,
 * `.tag-status`, `.btn`, `.primary`, `.sm`).
 *
 * The V4 mockup showed 3 hand-picked blocked contacts. The production port
 * replaces those per-row blocks with a ladder view that renders every tier
 * in the 5-tier taxonomy from `003_partners_mirror.sql`, counted from real
 * data in `partners_mirror.email_tier` for the active campaign's partners.
 * This is the "visualisation of the 5-tier deliverability ladder" Tristan
 * asked for — same `.gate-row` grid, five rows instead of three.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function VerificationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { c } = await searchParams;

  // Campaign resolution mirrors review/tracker: ?c=<uuid> wins, else the
  // `fc_active_campaign` cookie set by the top-bar switcher, else the
  // first active campaign.
  const campaigns = await listActiveCampaigns();
  const cookieStore = await cookies();
  const cookieCampaign = cookieStore.get("fc_active_campaign")?.value;
  const campaignId = resolveCurrentCampaignId(campaigns, c ?? cookieCampaign);

  if (!campaignId) {
    return <NoCampaignsState />;
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId) ?? null;
  const counts = await getVerificationCounts(campaignId);
  const totalPartners = counts.reduce((acc, row) => acc + row.count, 0);
  const blockedTotal = counts
    .filter((row) => BLOCKING_TIERS.has(row.tier))
    .reduce((acc, row) => acc + row.count, 0);

  return (
    <section id="verification" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.section-head` (lines 1649-1655) — title + subtitle verbatim. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Email verification gate &mdash; the reason a draft won&rsquo;t generate
            {activeCampaign ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · "}
                {activeCampaign.name}
              </span>
            ) : null}
          </div>
          <div className="section-sub">
            Founder-approved but blocked by email confidence. This gate is
            deliberate &mdash;{" "}
            <b>a Gmail bounce burns your sending reputation</b>; repeat bounces
            can suspend the account.
          </div>
        </div>
        {/* V4 `.section-link` (line 1654). Bulk verify via Hunter lands in
            a later phase — inert affordance, tooltip explains. */}
        <span
          className="section-link"
          title="Bulk Hunter verification lands in a later phase."
          style={{ cursor: "not-allowed", opacity: 0.7 }}
        >
          Bulk verify with Hunter &rarr;
        </span>
      </div>

      <div className="gate">
        {/* V4 `.gate-head` red banner (lines 1658-1661). Count resolves from
            real data — tiers that cannot advance to +2 Drafted. */}
        <div className="gate-head">
          <span className="gh-icon">!</span>
          <span>
            <b>
              {blockedTotal} contact{blockedTotal === 1 ? "" : "s"} blocked
            </b>
            {" · "}
            drafts will not generate until emails are resolved.
          </span>
        </div>

        {/* V4 `.gate-why` amber rationale (lines 1662-1665) — verbatim copy. */}
        <div className="gate-why">
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "var(--amber)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            ?
          </span>
          <span>
            <b>Why the gate exists:</b> Gmail flags senders who bounce
            repeatedly. At ~1% bounce rate, deliverability degrades. At ~5%,
            Gmail throttles. At ~10%, the account can be suspended. We
            block-not-guess instead.
          </span>
        </div>

        {/* Ladder — one `.gate-row` per tier in the 5-tier taxonomy.
            Counts are real; if the campaign has zero partners the rows
            render with "0" and the explanatory copy still reads true. */}
        {VERIFICATION_TIER_ORDER.map((tier) => {
          const row = counts.find((r) => r.tier === tier);
          return (
            <TierRow
              key={tier}
              tier={tier}
              count={row?.count ?? 0}
              totalPartners={totalPartners}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * Tiers that cannot advance a contact to +2 Drafted (per
 * V4-FEEDBACK-ROUND-2.md §"Verification tiers"). Used to size the red
 * banner's "N blocked" count.
 */
const BLOCKING_TIERS = new Set<VerificationTier>([
  "unverified",
  "generic_blocked",
  "bounced",
]);

/** Per-tier display content — labels, rationale copy, step progression,
 *  status-chip tone, and CTA text. Copy is original because V4's three
 *  hand-picked rows don't generalise. Voice: brief, technical, British
 *  spelling, no failure-mode framing. */
interface TierMeta {
  /** Short display name — left column, bold. */
  label: string;
  /** Sub-label after the bullet — mimics V4's `<span class="c">` partner name. */
  sub: string;
  /** Prose rationale — why this tier exists / what the gate says. */
  reason: React.ReactNode;
  /** 3-step progression — what's done, in-progress, pending for this tier. */
  steps: {
    label: string;
    tone: "done" | "active" | "pending";
    status: string;
  }[];
  /** Status-chip tone shown below the label. */
  chip:
    | { label: string; klass: "tag-status" | "tag-approved" | "tag-warn" | "tag-blocked" };
  /** Primary CTA text. V1 is inert — the button stays visible for parity. */
  cta: string;
  /** Tooltip explaining why the CTA is inert in V1. */
  ctaTitle: string;
}

const TIER_META: Record<VerificationTier, TierMeta> = {
  corresponded: {
    label: "Corresponded",
    sub: "100% confidence — we have replied to this address",
    reason: (
      <>
        Highest confidence tier. Partner has replied from this address, or
        we&rsquo;ve sent and received without a bounce. Drafts generate
        immediately for these contacts &mdash; no verification step needed.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "inbox reply logged — done" },
      { label: "2.", tone: "done", status: "address verified — done" },
      { label: "3.", tone: "done", status: "ready for +2 Drafted — done" },
    ],
    chip: { label: "+2 Ready", klass: "tag-approved" },
    cta: "Open in tracker",
    ctaTitle: "Tracker deep-link lands in a later phase.",
  },
  hunter_verified: {
    label: "Hunter verified",
    sub: "Hunter score ≥ 90 — pattern + deliverability both confirmed",
    reason: (
      <>
        Hunter returned a high score and confirmed the SMTP path accepts the
        address. Not as strong as a real reply, but strong enough to draft.
        Score and method are stored on{" "}
        <code>partners_mirror.email_verified_method</code>.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "Hunter lookup — done" },
      { label: "2.", tone: "done", status: "SMTP probe — accepted" },
      { label: "3.", tone: "done", status: "ready for +2 Drafted — done" },
    ],
    chip: { label: "+2 Ready", klass: "tag-approved" },
    cta: "Open in tracker",
    ctaTitle: "Tracker deep-link lands in a later phase.",
  },
  unverified: {
    label: "Unverified",
    sub: "Pattern guessed or missing — cannot advance to +2 Drafted",
    reason: (
      <>
        Address is either pattern-guessed with a low Hunter score, or we have
        no address at all. Cannot advance to <b>+2 Drafted</b> until a real
        email lands &mdash; the risk of a bounce here is what suspends Gmail
        accounts. Hunter re-verify or a LinkedIn cross-check resolves it.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "Hunter pattern guess — low score" },
      { label: "2.", tone: "active", status: "LinkedIn cross-check — queued" },
      { label: "3.", tone: "pending", status: "DB update — blocked" },
    ],
    chip: { label: "+1 Approved", klass: "tag-status" },
    cta: "Resolve email",
    ctaTitle: "Resolve-email flow lands in a later phase.",
  },
  generic_blocked: {
    label: "Generic inbox blocked",
    sub: "info@ / contact@ / hello@ — never meets send threshold",
    reason: (
      <>
        Addresses ending in <code>info@</code>, <code>contact@</code>,{" "}
        <code>hello@</code> never meet our send threshold &mdash; they route
        to shared inboxes where Tristan&rsquo;s note vanishes. We hunt for a
        named replacement before drafting.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "site scraped — generic only" },
      { label: "2.", tone: "active", status: "LinkedIn enrichment — needed" },
      { label: "3.", tone: "pending", status: "named replacement — pending" },
    ],
    chip: { label: "+1 Approved", klass: "tag-warn" },
    cta: "Hunt for replacement",
    ctaTitle: "Replacement-hunt flow lands in a later phase.",
  },
  bounced: {
    label: "Bounced",
    sub: "Hard bounce on record — address is dead",
    reason: (
      <>
        We&rsquo;ve already attempted this address and Gmail returned a hard
        bounce. Keeping it in the send pool is what drives the bounce rate
        past the 1% degrade threshold. Remove, or hunt for a current
        address before re-drafting.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "send attempted — hard bounce" },
      { label: "2.", tone: "pending", status: "mark partner inactive — needed" },
      { label: "3.", tone: "pending", status: "replacement search — pending" },
    ],
    chip: { label: "-2 Bounced", klass: "tag-blocked" },
    cta: "Mark inactive",
    ctaTitle: "Mark-inactive flow lands in a later phase.",
  },
};

function TierRow({
  tier,
  count,
  totalPartners,
}: {
  tier: VerificationTier;
  count: number;
  totalPartners: number;
}) {
  const meta = TIER_META[tier];
  const percent =
    totalPartners > 0 ? Math.round((count / totalPartners) * 100) : 0;

  return (
    <div className="gate-row">
      <div>
        <div className="gate-firm">
          {meta.label}{" "}
          <span className="c">
            {" · "}
            {count} contact{count === 1 ? "" : "s"}
            {totalPartners > 0 ? (
              <>
                {" "}({percent}%)
              </>
            ) : null}
          </span>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className={`tag-chip ${meta.chip.klass}`}>{meta.chip.label}</span>
        </div>
      </div>
      <div className="gate-reason">{meta.reason}</div>
      <div className="gate-steps">
        {meta.steps.map((step, idx) => (
          <div key={idx} className="gs-step">
            <span className={toneSpanClass(step.tone)}>{step.label}</span>{" "}
            {step.status.includes("—") ? (
              <StepStatus status={step.status} tone={step.tone} />
            ) : (
              <span>{step.status}</span>
            )}
          </div>
        ))}
      </div>
      <div className="gate-age">{count > 0 ? `${count} on list` : "—"}</div>
      <button
        className="btn primary sm"
        disabled
        title={meta.ctaTitle}
        style={{ cursor: "not-allowed", opacity: 0.7 }}
      >
        {meta.cta}
      </button>
    </div>
  );
}

function toneSpanClass(tone: "done" | "active" | "pending"): string {
  if (tone === "done") return "gs-d";
  if (tone === "active") return "gs-a";
  return "gs-p";
}

/**
 * Renders the post-em-dash status fragment with the correct tone span so
 * V4's `.gs-d` / `.gs-a` highlighting lands on the status word ("done",
 * "in progress", "blocked") rather than the step number.
 */
function StepStatus({
  status,
  tone,
}: {
  status: string;
  tone: "done" | "active" | "pending";
}) {
  const [prefix, suffix] = status.split(/\s—\s(.+)/);
  if (!suffix) return <span>{status}</span>;
  return (
    <span>
      {prefix} &mdash;{" "}
      <span className={toneSpanClass(tone)}>{suffix}</span>
    </span>
  );
}

/**
 * Shown when no campaigns are visible to the session — usually means the
 * user is unauthenticated and RLS denied the `campaigns` read. Mirrors the
 * tracker / review pages' equivalent empty state.
 */
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
        Sign in to load the verification gate. Row-level security gates every
        table until an authenticated session is present.
      </p>
    </div>
  );
}
