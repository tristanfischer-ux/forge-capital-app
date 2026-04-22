import Link from "next/link";
import type {
  PortfolioProfileData,
  PortfolioInvestorBacker,
} from "@/lib/queries/portfolio-profile";

/**
 * Full portfolio-company view reached from any portfolio chip on an
 * investor profile. Same visual vocabulary as `/investor/[id]` —
 * `modal-grid`, `m-section`, `ms-card`, `tag-chip` — so the page sits
 * in the same universe as the rest of the app.
 *
 * Layout:
 *   - Left column: headline (name, sector, stage, HQ, website) +
 *     "Backed by N investors" list.
 *   - Right side rail: key facts + provenance.
 *
 * Empty-state voice matches the project convention — never "No data",
 * always names the specific pipeline stage that fills the gap.
 */
export function PortfolioView({
  company,
}: {
  company: PortfolioProfileData;
}) {
  return (
    <div className="modal-grid" style={{ alignItems: "start" }}>
      <div>
        <PortfolioHeadline company={company} />
        <BackersBlock backers={company.backers} name={company.name} />
      </div>
      <SideRail company={company} />
    </div>
  );
}

function PortfolioHeadline({ company }: { company: PortfolioProfileData }) {
  const chips: React.ReactNode[] = [];
  if (company.sector) {
    chips.push(
      <span key="sector" className="tag-chip tag-neutral">
        {company.sector}
      </span>,
    );
  }
  if (company.stage) {
    chips.push(
      <span key="stage" className="tag-chip tag-status">
        {company.stage}
      </span>,
    );
  }
  return (
    <div className="m-section">
      {chips.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          {chips}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 12,
          color: "var(--text-dim)",
          flexWrap: "wrap",
        }}
      >
        {company.hq_location ? <span>{company.hq_location}</span> : null}
        {company.website ? (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
          >
            {company.website.replace(/^https?:\/\//, "")} ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function BackersBlock({
  backers,
  name,
}: {
  backers: PortfolioInvestorBacker[];
  name: string;
}) {
  if (backers.length === 0) {
    return (
      <div className="m-section">
        <h3>Backed by</h3>
        <p style={{ color: "var(--text-dim)" }}>
          No investor backers on file for {name} — the pipeline&rsquo;s
          04-research-portfolio step writes this once it scrapes the
          firm&rsquo;s portfolio page.
        </p>
      </div>
    );
  }
  return (
    <div className="m-section">
      <h3>Backed by · {backers.length} investor{backers.length === 1 ? "" : "s"}</h3>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        {backers.map((b) => (
          <BackerCard key={b.investor_id} backer={b} />
        ))}
      </div>
    </div>
  );
}

function BackerCard({ backer }: { backer: PortfolioInvestorBacker }) {
  // A "fact line" under the firm name — round / date / amount only if
  // any are present. Keep order round → date → amount so common formats
  // ("Series B · 2023 · $50M") fall out naturally.
  const factSegments: string[] = [];
  if (backer.round) factSegments.push(backer.round);
  if (backer.round_at) factSegments.push(backer.round_at);
  if (backer.amount_raw) factSegments.push(backer.amount_raw);
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
          <Link
            href={`/investor/${backer.investor_id}`}
            className="partner-link"
            aria-label={`Open investor profile for ${backer.firm_name ?? "investor"}`}
          >
            {backer.firm_name ?? `Investor #${backer.investor_id}`}
          </Link>
        </div>
        {backer.type ? (
          <span
            className="tag-chip tag-neutral"
            style={{ fontSize: 10 }}
          >
            {backer.type}
          </span>
        ) : null}
      </div>
      {backer.hq_location ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            marginBottom: 6,
          }}
        >
          {backer.hq_location}
        </div>
      ) : null}
      {factSegments.length > 0 ? (
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          {factSegments.join(" · ")}
        </div>
      ) : null}
      {backer.primary_partner_name ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 6,
          }}
        >
          Lead contact: {backer.primary_partner_name}
          {backer.primary_partner_title
            ? ` · ${backer.primary_partner_title}`
            : ""}
          {backer.partners_count > 1
            ? ` · ${backer.partners_count - 1} other partner${backer.partners_count - 1 === 1 ? "" : "s"}`
            : ""}
        </div>
      ) : backer.partners_count > 0 ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 6,
          }}
        >
          {backer.partners_count} partner{backer.partners_count === 1 ? "" : "s"}
          {" on file"}
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            marginBottom: 6,
          }}
        >
          No partners on file yet — the partner-discovery step fills this
          once it resolves team pages on the firm&rsquo;s website.
        </div>
      )}
      {backer.source_url ? (
        <a
          href={backer.source_url}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 11,
            color: "var(--accent)",
            display: "inline-block",
            marginTop: 2,
          }}
        >
          Source ↗
        </a>
      ) : null}
    </div>
  );
}

function SideRail({ company }: { company: PortfolioProfileData }) {
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FactsCard company={company} />
      <ProvenanceCard company={company} />
    </aside>
  );
}

function FactsCard({ company }: { company: PortfolioProfileData }) {
  const rows: Array<[string, string]> = [];
  if (company.sector) rows.push(["Sector", company.sector]);
  if (company.stage) rows.push(["Stage", company.stage]);
  if (company.hq_location) rows.push(["HQ", company.hq_location]);
  rows.push([
    "Investor backers",
    String(company.backers.length),
  ]);
  return (
    <div className="ms-card">
      <h4>Key facts</h4>
      {rows.map(([k, v]) => (
        <div key={k} className="ms-kv">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

function ProvenanceCard({ company }: { company: PortfolioProfileData }) {
  return (
    <div className="ms-card">
      <h4>Provenance</h4>
      <div className="ms-kv">
        <span className="k">Slug</span>
        <span className="v">
          <code>{company.slug}</code>
        </span>
      </div>
      <div className="ms-kv">
        <span className="k">Company id</span>
        <span className="v">{company.id}</span>
      </div>
      <div className="ms-kv">
        <span className="k">Last synced</span>
        <span className="v">
          {company.last_synced_at ?? (
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
        Data mirrors the Forge Capital pipeline SQLite nightly via
        research/14c-push-portfolio-to-capital-app.py. Edit at the source,
        not here.
      </p>
    </div>
  );
}
