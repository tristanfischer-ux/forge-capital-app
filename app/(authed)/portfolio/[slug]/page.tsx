import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortfolioCompany } from "@/lib/queries/portfolio-profile";
import { PortfolioView } from "./PortfolioView";
import { BreadcrumbsOverride } from "../../Breadcrumbs";

/**
 * Portfolio-company profile — full drill-down page for one canonical
 * `portfolio_companies` row. Reached by clicking a portfolio chip on an
 * investor profile. Share-link safe (slug is stable).
 *
 * Twin of `/investor/[id]` and `/partner/[id]` — same modal-grid
 * layout, same V4 vocabulary (no bespoke Tailwind approximations).
 */
export default async function PortfolioProfilePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await props.params;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) notFound();

  const company = await getPortfolioCompany(slug);
  if (!company) notFound();

  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      {/* Swap the final breadcrumb (default: raw slug) for the company's
          human-readable name. Layout-level <Breadcrumbs /> picks this up
          through BreadcrumbsProvider context. */}
      <BreadcrumbsOverride label={company.name} />
      <div className="section-head">
        <div>
          <h2 className="section-title">{company.name}</h2>
          <p className="section-sub">
            Portfolio company · slug <code>{company.slug}</code>
          </p>
        </div>
        <Link href="/match" className="as-link" style={{ fontSize: 13 }}>
          ← Back to Find a Match
        </Link>
      </div>

      <PortfolioView company={company} />
    </section>
  );
}
