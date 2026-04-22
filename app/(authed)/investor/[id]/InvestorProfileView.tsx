import Link from "next/link";
import type {
  InvestorProfileData,
  InvestorProfilePartner,
  InvestorProfileCampaignLink,
} from "@/lib/queries/investor-profile";
import { TierBadge } from "@/app/(authed)/tracker/TierBadge";

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
        <InvestorHeadline profile={profile} />
        <ThesisBlock profile={profile} />
        <SynthesisBlock profile={profile} />
        <PartnersBlock partners={profile.partners} />
        <ActivityBlock campaignLinks={profile.campaign_links} />
      </div>
      <SideRail profile={profile} />
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
        {profile.twitter_url ? (
          <a
            href={profile.twitter_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            Twitter ↗
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

function SynthesisBlock({ profile }: { profile: InvestorProfileData }) {
  const blocks: Array<{ title: string; body: string }> = [];
  if (profile.investment_pattern)
    blocks.push({ title: "Investment pattern", body: profile.investment_pattern });
  if (profile.connection_brief)
    blocks.push({ title: "Connection brief", body: profile.connection_brief });
  if (profile.team_expertise)
    blocks.push({ title: "Team expertise", body: profile.team_expertise });
  if (profile.ideal_company_profile)
    blocks.push({
      title: "Ideal company profile",
      body: profile.ideal_company_profile,
    });
  if (profile.value_add)
    blocks.push({ title: "Value add", body: profile.value_add });
  if (profile.recent_activity)
    blocks.push({ title: "Recent activity", body: profile.recent_activity });

  if (blocks.length === 0) {
    return (
      <div className="m-section">
        <h3>Research synthesis</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No research synthesis on file — the nightly Forge Capital
          synthesiser writes this after enriching the firm.
        </p>
      </div>
    );
  }

  return (
    <div className="m-section">
      <h3>Research synthesis</h3>
      {blocks.map((b) => (
        <div key={b.title} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            {b.title}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>{b.body}</p>
        </div>
      ))}
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
        {partners.map((p) => (
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
      {profile.portfolio_companies.length > 0 ? (
        <PortfolioCard names={profile.portfolio_companies} />
      ) : null}
      <ProvenanceCard profile={profile} />
    </aside>
  );
}

function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function FactsCard({ profile }: { profile: InvestorProfileData }) {
  const rows: Array<[string, string]> = [];
  if (profile.fund_size_usd != null)
    rows.push(["Fund size", formatUsd(profile.fund_size_usd)]);
  if (profile.cheque_min_usd != null || profile.cheque_max_usd != null) {
    const range =
      profile.cheque_min_usd != null && profile.cheque_max_usd != null
        ? `${formatUsd(profile.cheque_min_usd)} – ${formatUsd(profile.cheque_max_usd)}`
        : profile.cheque_min_usd != null
          ? `${formatUsd(profile.cheque_min_usd)}+`
          : `up to ${formatUsd(profile.cheque_max_usd)}`;
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

