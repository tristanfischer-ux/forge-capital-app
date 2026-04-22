import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvestorProfile } from "@/lib/queries/investor-profile";
import { InvestorProfileView } from "./InvestorProfileView";

/**
 * Investor profile — full drill-down page reached from double-clicking a
 * match result card or the "Open profile →" button in the expanded card.
 * Reads `investors_mirror` + every `partners_mirror` row on the firm +
 * any visible `campaign_partners` rows so the profile ties back into
 * outreach state. Never a modal — share-link safe.
 */
export default async function InvestorProfilePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await props.params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id)) notFound();

  const profile = await getInvestorProfile(id);
  if (!profile) notFound();

  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      <div className="section-head">
        <div>
          <h2 className="section-title">
            {profile.firm_name ?? (
              <span style={{ color: "var(--text-faint)" }}>Unnamed firm</span>
            )}
          </h2>
          <p className="section-sub">
            Investor profile · firm id {profile.id}
          </p>
        </div>
        <Link href="/match" className="as-link" style={{ fontSize: 13 }}>
          ← Back to Find a Match
        </Link>
      </div>

      <InvestorProfileView profile={profile} />
    </section>
  );
}
