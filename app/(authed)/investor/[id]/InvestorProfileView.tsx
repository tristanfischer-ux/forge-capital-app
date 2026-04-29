import Link from "next/link";
import type {
  InvestorProfileData,
  InvestorDeepProfile,
  InvestorProfilePartner,
  InvestorProfileCampaignLink,
} from "@/lib/queries/investor-profile";
import { TierBadge } from "@/app/(authed)/tracker/TierBadge";
import { PersonalisedInsight } from "./PersonalisedInsight";

/**
 * Full investor profile view. Uses V4 vocabulary — `.section`,
 * `.m-section`, `.ms-card`, `.ms-kv`, `.tag-chip` — so the page sits in
 * the same visual universe as the rest of the app. No new Tailwind
 * approximations: every colour/border/padding decision inherits from
 * `app/v4-mockup.css`.
 *
 * Empty states use the project's "name the pipeline stage" voice: no
 * "No data" strings. When Forge Capital hasn't synthesised prose yet we
 * say "No research synthesis on file — the nightly pipeline writes this
 * once an investor has been through the synthesiser."
 */
export function InvestorProfileView({
  profile,
}: {
  profile: InvestorProfileData;
}) {
  return (
    <div className="modal-grid" style={{ alignItems: "start" }}>
      <div>
        {/* Tier 1: Headline */}
        <InvestorHeadline profile={profile} />
        {/* Tier 2: Personalised insight (from sessionStorage, if available) */}
        <PersonalisedInsight investorId={profile.id} />
        {/* Tier 3: Thesis */}
        <ThesisBlock profile={profile} />
        {/* Tier 4: Ideal company profile (pulled out of synthesis) */}
        <IdealCompanyProfileBlock profile={profile} />
        {/* Value add — moved up per Tristan's request */}
        <ValueAddBlock profile={profile} />
        {/* Tier 7: Team expertise + Partners */}
        <TeamExpertiseBlock profile={profile} />
        <PartnersBlock partners={profile.partners} />
        {/* Tier 8: Investment pattern + Portfolio */}
        <InvestmentPatternBlock profile={profile} />
        <RelatedFirmsBlock relatedFirms={profile.related_firms} />
        {/* Tier 9: Connection brief + Recent activity + Campaign activity */}
        <ConnectionBriefBlock profile={profile} />
        <RecentActivityBlock profile={profile} />
        <ActivityBlock campaignLinks={profile.campaign_links} />
        {/* Deep dossier */}
        <DeepDossierBlock dossier={profile.deep_profile} />
      </div>
      <SideRail profile={profile} />
    </div>
  );
}

function RelatedFirmsBlock({
  relatedFirms,
}: {
  relatedFirms: InvestorProfileData["related_firms"];
}) {
  if (relatedFirms.length === 0) {
    return (
      <div className="m-section">
        <h3>Related firms</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No portfolio overlap with other investors yet — fills in as the
          nightly pipeline enriches more firms with their portfolio pages
          (research/04-research-portfolio.js).
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Related firms · {relatedFirms.length}</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {relatedFirms.map((r) => (
          <li
            key={r.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 12,
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link
                href={`/investor/${r.id}`}
                className="partner-link"
                style={{ fontWeight: 500 }}
                aria-label={`Open ${r.firm_name ?? "firm"} profile`}
              >
                {r.firm_name ?? "Unnamed firm"}
              </Link>
              {r.shared_examples.length > 0 ? (
                <div
                  style={{
                    color: "var(--text-faint)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  Shared: {r.shared_examples.join(", ")}
                </div>
              ) : null}
            </div>
            <span
              className="tag-chip tag-neutral"
              style={{ flexShrink: 0 }}
            >
              {r.shared_count} shared
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvestorHeadline({ profile }: { profile: InvestorProfileData }) {
  const chips: React.ReactNode[] = [];
  if (profile.actively_deploying === true) {
    chips.push(
      <span key="active" className="tag-chip tag-approved">
        <span className="dot" />
        Actively deploying
      </span>,
    );
  } else if (profile.actively_deploying === false) {
    chips.push(
      <span key="inactive" className="tag-chip tag-warn">
        <span className="dot" />
        Not actively deploying
      </span>,
    );
  }
  if (profile.type) {
    chips.push(
      <span key="type" className="tag-chip tag-neutral">
        {profile.type}
      </span>,
    );
  }
  return (
    <div className="m-section">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {chips}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 12,
          color: "var(--text-dim)",
          flexWrap: "wrap",
        }}
      >
        {profile.hq_location ? <span>{profile.hq_location}</span> : null}
        {profile.website ? (
          <a
            href={profile.website}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            {profile.website.replace(/^https?:\/\//, "")} ↗
          </a>
        ) : null}
        {profile.linkedin_url ? (
          <a
            href={profile.linkedin_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            LinkedIn ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ThesisBlock({ profile }: { profile: InvestorProfileData }) {
  const hasThesis =
    Boolean(profile.thesis_summary) || Boolean(profile.thesis_deep);
  return (
    <div className="m-section">
      <h3>Thesis</h3>
      {hasThesis ? (
        <>
          {profile.thesis_summary ? <p>{profile.thesis_summary}</p> : null}
          {profile.thesis_deep ? (
            <p style={{ marginTop: 8 }}>{profile.thesis_deep}</p>
          ) : null}
        </>
      ) : (
        <p style={{ color: "var(--text-dim)" }}>
          No thesis on file — pulls from the nightly Forge Capital sync once
          the investor has been through the research synthesiser.
        </p>
      )}
    </div>
  );
}

/** Tier 4: Ideal company profile — broken out of the old SynthesisBlock. */
function IdealCompanyProfileBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.ideal_company_profile) return null;
  return (
    <div className="m-section">
      <h3>Ideal company profile</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.ideal_company_profile}</p>
    </div>
  );
}

/** Tier 7: Team expertise lead paragraph (partners block follows separately). */
function TeamExpertiseBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.team_expertise) return null;
  return (
    <div className="m-section">
      <h3>Team expertise</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.team_expertise}</p>
    </div>
  );
}

/** Tier 8: Investment pattern lead paragraph (portfolio follows separately). */
function InvestmentPatternBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.investment_pattern) return null;
  return (
    <div className="m-section">
      <h3>Investment pattern</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.investment_pattern}</p>
    </div>
  );
}

/** Tier 9: Connection brief — approach angle for outreach. */
function ConnectionBriefBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.connection_brief) return null;
  return (
    <div className="m-section">
      <h3>Connection approach</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.connection_brief}</p>
    </div>
  );
}

/** Tier 9: Recent activity. */
function RecentActivityBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.recent_activity) return null;
  return (
    <div className="m-section">
      <h3>Recent activity</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.recent_activity}</p>
    </div>
  );
}

/** Value add — remaining synthesis field. */
function ValueAddBlock({ profile }: { profile: InvestorProfileData }) {
  if (!profile.value_add) return null;
  return (
    <div className="m-section">
      <h3>Value add</h3>
      <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.value_add}</p>
    </div>
  );
}

function PartnersBlock({
  partners,
}: {
  partners: InvestorProfilePartner[];
}) {
  if (partners.length === 0) {
    return (
      <div className="m-section">
        <h3>Partners</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No partners on file — the Forge Capital partner-discovery step
          fills this once it resolves team pages on the firm&rsquo;s website
          or LinkedIn.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>
        Partners · {partners.length}
      </h3>
      <div className="m-partners">
        {[...partners].sort((a, b) => {
          const aHasEmail = a.email ? 1 : 0;
          const bHasEmail = b.email ? 1 : 0;
          if (aHasEmail !== bHasEmail) return bHasEmail - aHasEmail;
          const aPrimary = a.is_primary_contact ? 1 : 0;
          const bPrimary = b.is_primary_contact ? 1 : 0;
          return bPrimary - aPrimary;
        }).map((p) => (
          <PartnerCard key={p.id} partner={p} />
        ))}
      </div>
    </div>
  );
}

function PartnerCard({ partner }: { partner: InvestorProfilePartner }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        background: "var(--surface-alt)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {partner.id != null && partner.name ? (
            <Link
              href={`/partner/${partner.id}`}
              className="partner-link"
              aria-label={`Open partner profile for ${partner.name}`}
            >
              {partner.name}
            </Link>
          ) : (
            partner.name ?? "Unnamed partner"
          )}
          {partner.is_primary_contact ? (
            <span
              className="tag-chip tag-approved"
              style={{ marginLeft: 8, fontSize: 10 }}
            >
              Primary
            </span>
          ) : null}
        </div>
        <TierBadge tier={partner.email_tier} />
      </div>
      {partner.title ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>
          {partner.title}
        </div>
      ) : null}
      {partner.email ? (
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <a
            href={`mailto:${partner.email}`}
            style={{ color: "var(--accent)" }}
          >
            {partner.email}
          </a>
        </div>
      ) : (
        <div
          style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6 }}
        >
          No email on file
        </div>
      )}
      {partner.focus_areas ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Focus: {partner.focus_areas}
        </div>
      ) : null}
      {partner.linkedin ? (
        <a
          href={partner.linkedin}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 11,
            color: "var(--accent)",
            display: "inline-block",
            marginTop: 6,
          }}
        >
          LinkedIn ↗
        </a>
      ) : null}
    </div>
  );
}

function ActivityBlock({
  campaignLinks,
}: {
  campaignLinks: InvestorProfileCampaignLink[];
}) {
  if (campaignLinks.length === 0) {
    return (
      <div className="m-section">
        <h3>Campaign activity</h3>
        <p style={{ color: "var(--text-dim)" }}>
          This firm isn&rsquo;t on any of your campaigns yet — shortlisting
          from Find a Match will add a tracker row.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Campaign activity · {campaignLinks.length}</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {campaignLinks.map((l, i) => (
          <li
            key={`${l.campaign_id}-${i}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid var(--border-soft)",
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>
                {l.campaign_name ?? "Unnamed campaign"}
              </div>
              <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {l.partner_name ?? "Unnamed partner"}
                {l.status_code ? (
                  <>
                    {" · "}
                    <code>{l.status_code}</code>
                    {l.status_label ? ` ${l.status_label}` : ""}
                  </>
                ) : null}
              </div>
            </div>
            <div style={{ color: "var(--text-faint)", fontSize: 11 }}>
              {l.days_since_last_contact === null
                ? "No contact yet"
                : l.days_since_last_contact === 0
                  ? "today"
                  : `${l.days_since_last_contact}d ago`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SideRail({ profile }: { profile: InvestorProfileData }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FactsCard profile={profile} />
      <FocusCard profile={profile} />
      {profile.canonical_portfolio.length > 0 ? (
        <CanonicalPortfolioCard rows={profile.canonical_portfolio} />
      ) : profile.portfolio_companies.length > 0 ? (
        <PortfolioCard names={profile.portfolio_companies} />
      ) : null}
      <ProvenanceCard profile={profile} />
    </aside>
  );
}

function CanonicalPortfolioCard({
  rows,
}: {
  rows: InvestorProfileData["canonical_portfolio"];
}) {
  const cap = 24;
  const shown = rows.slice(0, cap);
  const remainder = Math.max(0, rows.length - cap);
  return (
    <div className="ms-card">
      <h4>Portfolio · {rows.length}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.map((r) => (
          <div
            key={r.slug}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              fontSize: 12,
            }}
          >
            <Link
              href={`/portfolio/${r.slug}`}
              className="partner-link"
              style={{ fontWeight: 500, minWidth: 0 }}
              aria-label={`Open portfolio company profile for ${r.name}`}
            >
              {r.name}
            </Link>
            {r.round || r.round_at || r.amount_raw ? (
              <span
                style={{
                  color: "var(--text-faint)",
                  fontSize: 11,
                  flexShrink: 0,
                  textAlign: "right",
                }}
              >
                {[r.round, r.round_at, r.amount_raw]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {remainder > 0 ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            marginTop: 6,
            fontStyle: "italic",
          }}
        >
          + {remainder} more
        </div>
      ) : null}
    </div>
  );
}

const USD_TO_GBP = 0.79;

function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function formatGbp(value: number): string {
  const gbp = value * USD_TO_GBP;
  if (gbp >= 1_000_000_000) return `£${(gbp / 1_000_000_000).toFixed(1)}B`;
  if (gbp >= 1_000_000) return `£${Math.round(gbp / 1_000_000)}M`;
  if (gbp >= 1_000) return `£${Math.round(gbp / 1_000)}K`;
  return `£${gbp.toFixed(0)}`;
}

function formatDual(usd: number | null): string {
  if (usd == null) return "—";
  return `${formatUsd(usd)} (${formatGbp(usd)})`;
}

function FactsCard({ profile }: { profile: InvestorProfileData }) {
  const rows: Array<[string, string]> = [];
  if (profile.fund_size_usd != null)
    rows.push(["Fund size", formatDual(profile.fund_size_usd)]);
  if (profile.cheque_min_usd != null || profile.cheque_max_usd != null) {
    const range =
      profile.cheque_min_usd != null && profile.cheque_max_usd != null
        ? `${formatDual(profile.cheque_min_usd)} – ${formatDual(profile.cheque_max_usd)}`
        : profile.cheque_min_usd != null
          ? `${formatDual(profile.cheque_min_usd)}+`
          : `up to ${formatDual(profile.cheque_max_usd)}`;
    rows.push(["Cheque", range]);
  }
  if (profile.hardware_fit_score != null)
    rows.push([
      "Hardware fit",
      `${Math.round(profile.hardware_fit_score * 100)}%`,
    ]);
  if (profile.data_quality_score != null)
    rows.push([
      "Data quality",
      `${Math.round(profile.data_quality_score * 100)}%`,
    ]);
  if (profile.synthesis_confidence)
    rows.push(["Synthesis confidence", profile.synthesis_confidence]);

  return (
    <div className="ms-card">
      <h4>Key facts</h4>
      {rows.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            margin: 0,
          }}
        >
          No fund-size or cheque data yet — enriched nightly.
        </p>
      ) : (
        <>
          {rows.map(([k, v]) => (
            <div key={k} className="ms-kv">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FocusCard({ profile }: { profile: InvestorProfileData }) {
  const rows: Array<[string, string]> = [];
  if (profile.stage_focus) rows.push(["Stage", profile.stage_focus]);
  if (profile.sector_focus) rows.push(["Sector", profile.sector_focus]);
  if (profile.geo_focus) rows.push(["Geography", profile.geo_focus]);
  return (
    <div className="ms-card">
      <h4>Focus</h4>
      {rows.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            margin: 0,
          }}
        >
          No stage/sector/geo focus on file yet.
        </p>
      ) : (
        <>
          {rows.map(([k, v]) => (
            <div key={k} className="ms-kv">
              <span className="k">{k}</span>
              <span className="v" style={{ textAlign: "right" }}>
                {v}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Slugify a portfolio-company display name to the URL-safe canonical form
 * used by `/portfolio/[slug]`. MUST stay in lock-step with the
 * server-side dedupe slug in
 * `research/14c-push-portfolio-to-capital-app.py::slugify` — rule is:
 *   1. lower-case
 *   2. replace any run of non-[a-z0-9] with '-'
 *   3. trim leading/trailing '-'
 * Empty result (e.g. name is "—") means we can't link; fall back to a
 * plain chip so the card never shows a broken Link.
 */
function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PortfolioCard({ names }: { names: string[] }) {
  return (
    <div className="ms-card">
      <h4>Portfolio · {names.length}</h4>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {names.slice(0, 24).map((n) => {
          const slug = slugifyCompany(n);
          if (!slug) {
            return (
              <span
                key={n}
                className="tag-chip tag-neutral"
                style={{ fontSize: 11 }}
              >
                {n}
              </span>
            );
          }
          return (
            <Link
              key={n}
              href={`/portfolio/${slug}`}
              className="tag-chip tag-neutral partner-link"
              style={{ fontSize: 11 }}
              aria-label={`Open portfolio profile for ${n}`}
            >
              {n}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ProvenanceCard({ profile }: { profile: InvestorProfileData }) {
  return (
    <div className="ms-card">
      <h4>Provenance</h4>
      <div className="ms-kv">
        <span className="k">Firm id</span>
        <span className="v">{profile.id}</span>
      </div>
      <div className="ms-kv">
        <span className="k">Last enriched</span>
        <span className="v">
          {profile.last_enriched ?? (
            <span style={{ color: "var(--text-faint)" }}>—</span>
          )}
        </span>
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--text-faint)",
          marginTop: 8,
          lineHeight: 1.5,
        }}
      >
        Data mirrors the Forge Capital pipeline SQLite nightly. Edit at the
        source, not here.
      </p>
    </div>
  );
}

/**
 * Deep dossier — Opus-generated jsonb on `investor_deep_profiles`.
 * Returns null when no dossier has been generated for this investor yet
 * (the page never ships a hollow card).
 *
 * Renders the canonical top-level keys that every dossier row carries
 * — investment_thesis, fund_details, geo / stage / sector focus,
 * recent investments, recent news, fact-checks, quality assessment.
 * Sections that are missing from THIS dossier (the jsonb is open-ended)
 * collapse silently rather than rendering an empty header.
 *
 * Voice: dossier sections lead with the synthesised content; the jsonb
 * came from the Opus pipeline so the prose is already in the right
 * register. We add no editorial framing.
 */
function DeepDossierBlock({
  dossier,
}: {
  dossier: InvestorDeepProfile | null;
}) {
  if (!dossier) return null;

  const thesis = dossier.investment_thesis;
  const fund = dossier.fund_details;
  const tickets = dossier.tickets;
  const team = dossier.team;
  const sector = dossier.sector_focus;
  const stage = dossier.stage_focus;
  const geo = dossier.geo_focus;
  const recentInv = dossier.recent_investments;
  const recentNews = dossier.recent_news;
  const fact = dossier.fact_checks;
  const quality = dossier.quality_assessment;

  // If literally every section is missing, render nothing rather than a
  // hollow "Deep dossier" card. The component is opt-in by data presence.
  const hasAnything =
    Boolean(thesis?.primary_statement) ||
    Boolean(thesis?.detailed_description) ||
    Boolean(fund?.current_fund_name || fund?.fund_size_usd) ||
    Boolean(tickets?.minimum_usd || tickets?.typical_usd || tickets?.maximum_usd) ||
    Boolean(team?.total_partners) ||
    (sector && sector.length > 0) ||
    (stage && stage.length > 0) ||
    (geo && geo.length > 0) ||
    (recentInv && recentInv.length > 0) ||
    (recentNews && recentNews.length > 0) ||
    Boolean(fact && Object.keys(fact).length > 0) ||
    Boolean(quality);
  if (!hasAnything) return null;

  return (
    <div className="m-section">
      <h3>
        Deep dossier
        {quality?.verification_level ? (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {quality.verification_level}
            {quality.source_reliability
              ? ` · ${quality.source_reliability}`
              : ""}
          </span>
        ) : null}
      </h3>

      {/* Investment thesis — primary statement + detailed description.
          The detailed paragraph is the most useful single block in a
          dossier; we lead with it. */}
      {thesis?.primary_statement || thesis?.detailed_description ? (
        <div style={{ marginBottom: 14 }}>
          <DossierLabel>Investment thesis</DossierLabel>
          {thesis?.primary_statement ? (
            <p style={{ fontSize: 13, lineHeight: 1.65, fontWeight: 500 }}>
              {thesis.primary_statement}
            </p>
          ) : null}
          {thesis?.detailed_description ? (
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.65,
                marginTop: 6,
                color: "var(--text-dim)",
              }}
            >
              {thesis.detailed_description}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Fund details + ticket envelope — combined into a single
          two-column key/value block so the numbers sit next to each other. */}
      {fund || tickets || team?.total_partners ? (
        <div style={{ marginBottom: 14 }}>
          <DossierLabel>Fund &amp; team</DossierLabel>
          <div className="ms-kv">
            <span className="k">Current fund</span>
            <span className="v">
              {fund?.current_fund_name ?? <DossierFaint>not on file</DossierFaint>}
            </span>
          </div>
          {fund?.fund_size_usd ? (
            <div className="ms-kv">
              <span className="k">Fund size</span>
              <span className="v">{formatUsd(fund.fund_size_usd)}</span>
            </div>
          ) : null}
          {fund?.fund_vintage ? (
            <div className="ms-kv">
              <span className="k">Vintage</span>
              <span className="v">{fund.fund_vintage}</span>
            </div>
          ) : null}
          {tickets &&
          (tickets.minimum_usd || tickets.typical_usd || tickets.maximum_usd) ? (
            <div className="ms-kv">
              <span className="k">Cheque envelope</span>
              <span className="v">
                {tickets.minimum_usd ? formatUsd(tickets.minimum_usd) : "—"}
                {" / "}
                {tickets.typical_usd ? formatUsd(tickets.typical_usd) : "—"}
                {" / "}
                {tickets.maximum_usd ? formatUsd(tickets.maximum_usd) : "—"}
                <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>
                  min / typical / max
                </span>
              </span>
            </div>
          ) : null}
          {team?.total_partners ? (
            <div className="ms-kv">
              <span className="k">Partners on file</span>
              <span className="v">{team.total_partners}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Focus chips — sector, stage, geo as small chip rows. */}
      {(sector && sector.length > 0) ||
      (stage && stage.length > 0) ||
      (geo && geo.length > 0) ? (
        <div style={{ marginBottom: 14 }}>
          <DossierLabel>Focus</DossierLabel>
          <div style={{ display: "grid", gap: 8 }}>
            {sector && sector.length > 0 ? (
              <ChipsRow label="Sector" items={sector} />
            ) : null}
            {stage && stage.length > 0 ? (
              <ChipsRow label="Stage" items={stage} />
            ) : null}
            {geo && geo.length > 0 ? (
              <ChipsRow label="Geo" items={geo} />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Recent investments — table-like list of company / sector / stage. */}
      {recentInv && recentInv.length > 0 ? (
        <details
          open
          style={{ marginBottom: 14 }}
        >
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
            }}
          >
            <DossierLabel>Recent investments · {recentInv.length}</DossierLabel>
          </summary>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {recentInv.map((inv, idx) => (
              <li
                key={`${inv.company_name ?? "unnamed"}-${idx}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-soft)",
                  fontSize: 12,
                  gap: 12,
                }}
              >
                <span style={{ fontWeight: 500 }}>
                  {inv.company_name ?? "Unnamed company"}
                </span>
                <span
                  style={{
                    color: "var(--text-dim)",
                    fontSize: 11,
                    textAlign: "right",
                  }}
                >
                  {[inv.stage, inv.sector, inv.date].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Recent news — headline list with reasonable truncation. */}
      {recentNews && recentNews.length > 0 ? (
        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", listStyle: "none" }}>
            <DossierLabel>Recent news · {recentNews.length}</DossierLabel>
          </summary>
          <ul
            style={{
              listStyle: "disc",
              paddingLeft: 18,
              margin: "4px 0 0 0",
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.55,
            }}
          >
            {recentNews.map((line, idx) => (
              <li key={idx} style={{ marginBottom: 4 }}>
                {line}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Fact-check ribbon — small pill row showing CONFIRMED / VERIFIED
          / CONSISTENT verdicts on individual claims in the dossier. */}
      {fact && Object.keys(fact).length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <DossierLabel>Fact checks</DossierLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(fact).map(([key, verdict]) => (
              <span
                key={key}
                className={`tag-chip ${factVerdictKlass(verdict)}`}
              >
                {key.replace(/_/g, " ")} · {verdict}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {dossier.generated_at ? (
        <p
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            marginTop: 12,
            lineHeight: 1.5,
          }}
        >
          Generated {dossier.generated_at} by the deep-dossier synthesiser.
        </p>
      ) : null}
    </div>
  );
}

function DossierLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function ChipsRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-faint)",
          minWidth: 48,
        }}
      >
        {label}
      </span>
      {items.map((item) => (
        <span key={item} className="tag-chip tag-neutral" style={{ fontSize: 11 }}>
          {item}
        </span>
      ))}
    </div>
  );
}

function DossierFaint({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
      {children}
    </span>
  );
}

function factVerdictKlass(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v === "CONFIRMED" || v === "VERIFIED" || v === "CONSISTENT") {
    return "tag-approved";
  }
  if (v === "DISPUTED" || v === "INCONSISTENT" || v === "FAILED") {
    return "tag-blocked";
  }
  return "tag-warn";
}

