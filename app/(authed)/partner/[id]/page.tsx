import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerProfile } from "@/lib/queries/partner-profile";
import { PartnerProfileView } from "./PartnerProfileView";
import { BreadcrumbsOverride } from "../../Breadcrumbs";
import { LogInteractionButton } from "./LogInteractionModal";

/**
 * Partner profile — full drill-down page for one `partners_mirror` row.
 * Reached by clicking a partner name from an investor profile,
 * colleague list, or a tracker row. Share-link safe.
 *
 * Stylistic twin of `/investor/[id]` — same modal-grid layout, same
 * V4 vocabulary (no bespoke Tailwind approximations).
 */
export default async function PartnerProfilePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await props.params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id)) notFound();

  const partner = await getPartnerProfile(id);
  if (!partner) notFound();

  const backHref = partner.firm?.id != null ? `/investor/${partner.firm.id}` : "/match";
  const backLabel =
    partner.firm?.id != null
      ? `← Back to ${partner.firm.firm_name ?? "firm"}`
      : "← Back to Find a Match";

  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      {/* Swap the final breadcrumb (default: raw partner id) for the
          partner's human-readable name. Layout-level <Breadcrumbs />
          picks this up through BreadcrumbsProvider context. */}
      <BreadcrumbsOverride label={partner.name ?? "Partner"} />
      <div className="section-head">
        <div>
          <h2 className="section-title">
            {partner.name ?? (
              <span style={{ color: "var(--text-faint)" }}>Unnamed partner</span>
            )}
          </h2>
          <p className="section-sub">
            Partner profile · partner id {partner.id}
          </p>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <LogInteractionButton partnerId={partner.id} />
          <Link
            href={`/graph/partner/${partner.id}`}
            className="as-link"
            style={{ fontSize: 13 }}
          >
            View as graph →
          </Link>
          <Link href={backHref} className="as-link" style={{ fontSize: 13 }}>
            {backLabel}
          </Link>
        </div>
      </div>

      <PartnerProfileView partner={partner} />
    </section>
  );
}
