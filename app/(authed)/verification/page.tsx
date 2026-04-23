import Link from "next/link";
import { cookies } from "next/headers";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import {
  getVerificationCounts,
  getVerificationTierRefs,
  VERIFICATION_TIER_ORDER,
  type VerificationTier,
  type VerificationTierCount,
  type VerificationTierRefs,
} from "@/lib/queries/verification";
import { TierRowActions } from "./TierRowActions";

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
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /verification — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c } = await searchParams;

  // Campaign resolution mirrors review/tracker: ?c=<uuid> wins, else the
  // `fc_active_campaign` cookie set by the top-bar switcher, else the
  // first active campaign. Skipped when the composer passes pre-fetched data.
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
    return <NoCampaignsState />;
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId) ?? null;
  const [counts, tierRefs] = await Promise.all([
    getVerificationCounts(campaignId),
    getVerificationTierRefs(campaignId),
  ]);
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
            render with "0" and the explanatory copy still reads true.
            `tierRefs` gives each row the partner-ids it operates on
            (Hunter queue, mark-inactive, modal-open). */}
        {VERIFICATION_TIER_ORDER.map((tier) => {
          const row = counts.find((r) => r.tier === tier);
          return (
            <TierRow
              key={tier}
              tier={tier}
              count={row?.count ?? 0}
              totalPartners={totalPartners}
              campaignId={campaignId}
              refs={tierRefs[tier]}
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
 * banner's "N blocked" count. Includes the NeverBounce blocked variants
 * added 2026-04-23 — `invalid` (confirmed undeliverable), `disposable`
 * (throwaway address), and `unknown` (no verdict, treated as uncertain
 * and folded into the blocked count for safety).
 */
const BLOCKING_TIERS = new Set<VerificationTier>([
  "unverified",
  "generic_blocked",
  "bounced",
  "neverbounce_invalid",
  "neverbounce_disposable",
  "neverbounce_unknown",
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
    ctaTitle: "Jump to the tracker filtered to Corresponded partners.",
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
    ctaTitle: "Jump to the tracker filtered to Hunter-verified partners.",
  },
  neverbounce_valid: {
    label: "NeverBounce valid",
    sub: "NeverBounce confirmed deliverable — safe to send",
    reason: (
      <>
        NeverBounce ran the address against its mailbox-level checks and
        returned <code>valid</code>. Drafts generate immediately for these
        contacts &mdash; the verdict is stronger than a Hunter pattern match
        because NeverBounce talks to the receiving server.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "NeverBounce probe — valid" },
      { label: "2.", tone: "done", status: "deliverability — confirmed" },
      { label: "3.", tone: "done", status: "ready for +2 Drafted — done" },
    ],
    chip: { label: "+2 Ready", klass: "tag-approved" },
    cta: "Open in tracker",
    ctaTitle: "Jump to the tracker filtered to NeverBounce-valid partners.",
  },
  neverbounce_catchall: {
    label: "NeverBounce catch-all",
    sub: "Domain accepts everything — may bounce, not known-bad",
    reason: (
      <>
        NeverBounce reports the domain is configured as a catch-all: every
        address routes to a single inbox or vanishes silently. Sendable but
        carries some bounce risk &mdash; we still draft, and weight these
        rows lower in batch sends so a stale catch-all doesn&rsquo;t take
        deliverability with it.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "NeverBounce probe — catch-all" },
      { label: "2.", tone: "done", status: "deliverability — uncertain but accepted" },
      { label: "3.", tone: "done", status: "ready for +2 Drafted — done" },
    ],
    chip: { label: "+2 Ready", klass: "tag-approved" },
    cta: "Open in tracker",
    ctaTitle: "Jump to the tracker filtered to NeverBounce catch-all partners.",
  },
  neverbounce_unknown: {
    label: "NeverBounce unknown",
    sub: "No verdict returned — treat as unverified",
    reason: (
      <>
        NeverBounce probed the address and returned no decision &mdash; the
        receiving server timed out or refused the probe. Sits in the
        uncertain bucket alongside <b>Unverified</b>: cannot advance to
        <b> +2 Drafted</b> without a Hunter cross-check or a manual
        LinkedIn confirm.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "NeverBounce probe — no verdict" },
      { label: "2.", tone: "active", status: "Hunter cross-check — queued" },
      { label: "3.", tone: "pending", status: "DB update — blocked" },
    ],
    chip: { label: "+1 Approved", klass: "tag-status" },
    cta: "Resolve email",
    ctaTitle: "Open the resolve-email modal on the first NeverBounce-unknown firm.",
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
    ctaTitle: "Open the resolve-email modal on the first unverified firm.",
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
    ctaTitle: "Queue every generic-inbox partner for the nightly Hunter run.",
  },
  neverbounce_invalid: {
    label: "NeverBounce invalid",
    sub: "NeverBounce confirmed undeliverable — address is dead",
    reason: (
      <>
        NeverBounce confirmed the address does not accept mail. Sending
        anyway would be a near-guaranteed bounce. Hunt for a current
        address before re-drafting.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "NeverBounce probe — invalid" },
      { label: "2.", tone: "active", status: "LinkedIn enrichment — needed" },
      { label: "3.", tone: "pending", status: "named replacement — pending" },
    ],
    chip: { label: "-2 Bounced", klass: "tag-blocked" },
    cta: "Hunt for replacement",
    ctaTitle: "Queue every NeverBounce-invalid partner for the nightly Hunter run.",
  },
  neverbounce_disposable: {
    label: "NeverBounce disposable",
    sub: "Throwaway / disposable address — cannot send",
    reason: (
      <>
        NeverBounce flagged this as a disposable mailbox &mdash; a one-time
        forwarding address that won&rsquo;t reach anyone real. Skip and
        hunt the partner&rsquo;s actual work address.
      </>
    ),
    steps: [
      { label: "1.", tone: "done", status: "NeverBounce probe — disposable" },
      { label: "2.", tone: "active", status: "LinkedIn enrichment — needed" },
      { label: "3.", tone: "pending", status: "real address — pending" },
    ],
    chip: { label: "-2 Bounced", klass: "tag-blocked" },
    cta: "Hunt for replacement",
    ctaTitle: "Queue every NeverBounce-disposable partner for the nightly Hunter run.",
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
    ctaTitle:
      "Mark every bounced partner inactive (-3 Disqualified). Reversible via tracker.",
  },
};

function TierRow({
  tier,
  count,
  totalPartners,
  campaignId,
  refs,
}: {
  tier: VerificationTier;
  count: number;
  totalPartners: number;
  campaignId: string;
  refs: VerificationTierRefs;
}) {
  const meta = TIER_META[tier];
  const percent =
    totalPartners > 0 ? Math.round((count / totalPartners) * 100) : 0;

  // Ready tiers (sendable bucket) open the tracker with a tier filter
  // applied — server-rendered <Link>, no client state. Blocked tiers
  // delegate to the client `TierRowActions` component which handles the
  // modal / bulk server action / toast.
  const isReadyTier =
    tier === "corresponded" ||
    tier === "hunter_verified" ||
    tier === "neverbounce_valid" ||
    tier === "neverbounce_catchall";

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
      {isReadyTier ? (
        <Link
          href={`/tracker?c=${campaignId}&tier=${tier}`}
          className="btn primary sm"
          title={meta.ctaTitle}
          aria-label={meta.cta}
          data-tier={tier}
          style={
            count === 0
              ? { pointerEvents: "none", opacity: 0.5, cursor: "not-allowed" }
              : undefined
          }
          aria-disabled={count === 0 ? "true" : undefined}
        >
          {meta.cta}
        </Link>
      ) : (
        <TierRowActions
          tier={tier}
          count={count}
          firstInvestorId={refs.firstInvestorId}
          partnerIds={refs.partnerIds}
          campaignPartnerIds={refs.campaignPartnerIds}
        />
      )}
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
