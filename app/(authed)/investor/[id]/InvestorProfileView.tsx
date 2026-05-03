import Link from "next/link";
import type {
  InvestorProfileData,
  InvestorDeepProfile,
  InvestorProfilePartner,
  InvestorProfileCampaignLink,
} from "@/lib/queries/investor-profile";
import { TierBadge } from "@/app/(authed)/tracker/TierBadge";
import { PersonalisedInsight } from "./PersonalisedInsight";
import { SourceEvidence } from "./SourceEvidence";
import { CollapsibleSection } from "./CollapsibleSection";

/**
 * Full investor profile view — single-column layout with a fact strip
 * at the top and collapsible §-numbered sections. Uses V4 vocabulary —
 * `.section`, `.m-section`, `.ms-card`, `.ms-kv`, `.tag-chip` — so the
 * page sits in the same visual universe as the rest of the app.
 *
 * Empty states use the project's "name the pipeline stage" voice.
 */
export function InvestorProfileView({
  profile,
}: {
  profile: InvestorProfileData;
}) {
  return (
    <div style={{ maxWidth: 900 }}>
      <InvestorHeadline profile={profile} />

      <FactStrip profile={profile} />

      {/* §1 — Recent news */}
      <RecentNewsBlock dossier={profile.deep_profile} />

      <PersonalisedInsight investorId={profile.id} />

      {/* §2 — Thesis */}
      <CollapsibleSection number={2} title="Thesis" previewLines={3}>
        <ThesisContent profile={profile} />
      </CollapsibleSection>

      {/* §3 — Ideal company profile + Value add */}
      <CollapsibleSection number={3} title="Ideal company profile" previewLines={3}>
        <IdealAndValueContent profile={profile} />
      </CollapsibleSection>

      {/* §4 — Investment pattern + Recent investments + Related firms */}
      <CollapsibleSection number={4} title="Investment pattern" previewLines={4}>
        <InvestmentContent profile={profile} dossier={profile.deep_profile} />
      </CollapsibleSection>

      {/* §5 — Connection brief + Campaign activity */}
      <CollapsibleSection number={5} title="Connection & activity" previewLines={2}>
        <ConnectionContent profile={profile} />
      </CollapsibleSection>

      {/* §6 — Partners */}
      <CollapsibleSection number={6} title={`Partners · ${profile.partners.length}`} previewLines={6}>
        <PartnersContent partners={profile.partners} />
      </CollapsibleSection>

      {/* §7 — Deep dossier (remaining) */}
      <CollapsibleSection number={7} title="Deep dossier" previewLines={4}>
        <DeepDossierContent dossier={profile.deep_profile} />
      </CollapsibleSection>

      {/* §8 — Source evidence (chunks from scraped website, matched to hero text) */}
      <SourceEvidence investorId={profile.id} />

      {/* Portfolio (canonical or legacy names) — below the collapsibles */}
      {profile.canonical_portfolio.length > 0 ? (
        <CanonicalPortfolioCard rows={profile.canonical_portfolio} />
      ) : profile.portfolio_companies.length > 0 ? (
        <PortfolioCard names={profile.portfolio_companies} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  §1 — Headline                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  §2 — Fact strip (replaces old sidebar)                            */
/* ------------------------------------------------------------------ */

function FactStrip({ profile }: { profile: InvestorProfileData }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <FactsCard profile={profile} />
      <FocusCard profile={profile} />
      <ProvenanceCard profile={profile} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  §1 — Recent news                                                  */
/* ------------------------------------------------------------------ */

function RecentNewsBlock({ dossier }: { dossier: InvestorDeepProfile | null }) {
  if (!dossier?.recent_news || dossier.recent_news.length === 0) return null;

  return (
    <div className="m-section">
      <h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", marginRight: 8 }}>§1</span>
        Recent news · {dossier.recent_news.length}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {dossier.recent_news.map((item, i) => {
          // Handle both string entries and {headline, date, source, summary} objects
          let headline: string;
          let meta: string | null = null;
          if (typeof item === "string") {
            headline = item;
          } else if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            headline = String(obj.headline ?? obj.summary ?? JSON.stringify(item));
            const parts: string[] = [];
            if (obj.date) parts.push(String(obj.date));
            if (obj.source) parts.push(String(obj.source));
            meta = parts.length > 0 ? parts.join(" · ") : null;
          } else {
            headline = String(item);
          }
          const urlMatch = headline.match(/https?:\/\/[^\s)]+/);
          const url = urlMatch ? urlMatch[0] : null;
          const displayText = url ? headline.replace(url, "").replace(/\s{2,}/g, " ").trim() : headline;
          return (
            <div
              key={i}
              style={{
                padding: "10px 14px",
                border: "1px solid var(--border-soft)",
                borderRadius: 8,
                background: "var(--surface-alt)",
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text-dim)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <span style={{ color: "var(--text)" }}>{displayText}</span>
                {meta ? (
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{meta}</div>
                ) : null}
              </div>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: "var(--accent)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Source ↗
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  §2 — Thesis content                                               */
/* ------------------------------------------------------------------ */

function ThesisContent({ profile }: { profile: InvestorProfileData }) {
  return (
    <>
      {profile.thesis_summary ? <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.thesis_summary}</p> : null}
      {profile.thesis_deep ? (
        <p style={{ fontSize: 13, lineHeight: 1.65, marginTop: 8, whiteSpace: "pre-line" }}>{profile.thesis_deep}</p>
      ) : null}
      {!profile.thesis_summary && !profile.thesis_deep ? (
        <p style={{ color: "var(--text-dim)" }}>No thesis on file — pulls from the nightly Forge Capital sync.</p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  §3 — Ideal company profile + Value add                            */
/* ------------------------------------------------------------------ */

function IdealAndValueContent({ profile }: { profile: InvestorProfileData }) {
  return (
    <>
      {profile.ideal_company_profile ? (
        <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.ideal_company_profile}</p>
      ) : null}
      {profile.value_add ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Value add</div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.value_add}</p>
        </div>
      ) : null}
      {!profile.ideal_company_profile && !profile.value_add ? (
        <p style={{ color: "var(--text-dim)" }}>No ideal company profile on file yet.</p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  §4 — Investment pattern + Recent investments + Related firms       */
/* ------------------------------------------------------------------ */

function InvestmentContent({ profile, dossier }: { profile: InvestorProfileData; dossier: InvestorDeepProfile | null }) {
  const recentInv = dossier?.recent_investments ?? null;
  return (
    <>
      {profile.investment_pattern ? (
        <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.investment_pattern}</p>
      ) : null}
      {profile.recent_activity ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Recent activity</div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.recent_activity}</p>
        </div>
      ) : null}
      {recentInv && recentInv.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Recent investments · {recentInv.length}</div>
          {recentInv.map((inv, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 12 }}>
              <span style={{ fontWeight: 500 }}>{inv.company_name || "—"}</span>
              <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                {[inv.stage, inv.sector, inv.date].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {/* Related firms — co-investors sharing portfolio companies */}
      <RelatedFirmsInline relatedFirms={profile.related_firms} />
      {!profile.investment_pattern && !profile.recent_activity && (!recentInv || recentInv.length === 0) && profile.related_firms.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No investment pattern data on file yet.</p>
      ) : null}
    </>
  );
}

function RelatedFirmsInline({
  relatedFirms,
}: {
  relatedFirms: InvestorProfileData["related_firms"];
}) {
  if (relatedFirms.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Related firms · {relatedFirms.length}</div>
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

/* ------------------------------------------------------------------ */
/*  §5 — Connection & activity                                        */
/* ------------------------------------------------------------------ */

function ConnectionContent({ profile }: { profile: InvestorProfileData }) {
  return (
    <>
      {profile.connection_brief ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Connection approach</div>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>{profile.connection_brief}</p>
        </div>
      ) : null}
      <ActivityBlock campaignLinks={profile.campaign_links} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  §6 — Partners                                                     */
/* ------------------------------------------------------------------ */

function PartnersContent({ partners }: { partners: InvestorProfilePartner[] }) {
  if (partners.length === 0) {
    return (
      <p style={{ color: "var(--text-dim)" }}>
        No partners on file — the Forge Capital partner-discovery step fills this.
      </p>
    );
  }
  const sorted = [...partners].sort((a, b) => {
    const aHasEmail = a.email ? 1 : 0;
    const bHasEmail = b.email ? 1 : 0;
    if (aHasEmail !== bHasEmail) return bHasEmail - aHasEmail;
    const aPrimary = a.is_primary_contact ? 1 : 0;
    const bPrimary = b.is_primary_contact ? 1 : 0;
    return bPrimary - aPrimary;
  });
  return (
    <div className="m-partners">
      {sorted.map((p) => (
        <PartnerCard key={p.id} partner={p} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  §7 — Deep dossier content (minus news/focus/tickets shown above)  */
/* ------------------------------------------------------------------ */

function DeepDossierContent({
  dossier,
}: {
  dossier: InvestorDeepProfile | null;
}) {
  if (!dossier) {
    return (
      <p style={{ color: "var(--text-dim)" }}>
        No deep dossier generated yet — the synthesiser writes this once the
        investor has been through the research pipeline.
      </p>
    );
  }

  const thesis = dossier.investment_thesis;
  const fund = dossier.fund_details;
  const team = dossier.team;
  const recentInv = dossier.recent_investments;
  const fact = dossier.fact_checks;
  const quality = dossier.quality_assessment;

  const hasAnything =
    Boolean(thesis?.primary_statement) ||
    Boolean(thesis?.detailed_description) ||
    Boolean(fund?.current_fund_name || fund?.fund_size_usd) ||
    Boolean(team?.total_partners) ||
    (recentInv && recentInv.length > 0) ||
    Boolean(fact && Object.keys(fact).length > 0) ||
    Boolean(quality);
  if (!hasAnything) {
    return (
      <p style={{ color: "var(--text-dim)" }}>
        Dossier exists but contains no structured sections yet.
      </p>
    );
  }

  return (
    <>
      {quality?.verification_level ? (
        <div style={{ marginBottom: 10 }}>
          <span
            style={{
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
        </div>
      ) : null}

      {/* Investment thesis */}
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

      {/* Fund details + team */}
      {fund || team?.total_partners ? (
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
          {team?.total_partners ? (
            <div className="ms-kv">
              <span className="k">Partners on file</span>
              <span className="v">{team.total_partners}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Recent investments (more detail than §4) */}
      {recentInv && recentInv.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <DossierLabel>Recent investments · {recentInv.length}</DossierLabel>
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
        </div>
      ) : null}

      {/* Fact-check ribbon */}
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared components — kept from original                            */
/* ------------------------------------------------------------------ */

function PartnerCard({ partner }: { partner: InvestorProfilePartner }) {
  const displayBio = partner.deep_bio || partner.bio;
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
          {partner.email_verified ? (
            <span className="tag-chip tag-approved" style={{ marginLeft: 6, fontSize: 9 }}>Verified</span>
          ) : null}
          {partner.email_source ? (
            <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 6 }}>
              via {partner.email_source}
            </span>
          ) : null}
        </div>
      ) : (
        <div
          style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6 }}
        >
          No email on file
        </div>
      )}
      {displayBio ? (
        <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 6 }}>
          {displayBio}
        </p>
      ) : null}
      {partner.focus_areas ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Focus: {partner.focus_areas}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {partner.linkedin ? (
          <a
            href={partner.linkedin}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: "var(--accent)" }}
          >
            LinkedIn ↗
          </a>
        ) : null}
        {partner.twitter ? (
          <a
            href={partner.twitter}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: "var(--accent)" }}
          >
            Twitter ↗
          </a>
        ) : null}
      </div>
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
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Campaign activity</div>
        <p style={{ color: "var(--text-dim)" }}>
          This firm isn&rsquo;t on any of your campaigns yet — shortlisting
          from Find a Match will add a tracker row.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Campaign activity · {campaignLinks.length}</div>
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
  // hardware_fit_score and data_quality_score are stored as text in the DB
  // on a 0-10 scale. Parse to float and multiply by 10 for a 0-100% display.
  const hwScore =
    profile.hardware_fit_score != null
      ? parseFloat(String(profile.hardware_fit_score))
      : null;
  if (hwScore != null && Number.isFinite(hwScore) && hwScore > 0)
    rows.push(["Hardware fit", `${Math.round(hwScore * 10)}%`]);
  const dqScore =
    profile.data_quality_score != null
      ? parseFloat(String(profile.data_quality_score))
      : null;
  if (dqScore != null && Number.isFinite(dqScore))
    rows.push(["Data quality", `${Math.round(dqScore * 10)}%`]);
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

/* ------------------------------------------------------------------ */
/*  Utility components                                                */
/* ------------------------------------------------------------------ */

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
