import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartnerProfile } from "@/lib/queries/partner-profile";
import { RaiseStatusForm } from "../../partner/[id]/RaiseStatusForm";

export const dynamic = "force-dynamic";

export default async function DeskPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(id)) notFound();
  const partner = await getPartnerProfile(id);
  if (!partner) notFound();

  const raiseCount = partner.campaign_links.length;

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>
            {partner.name ?? "Unnamed partner"}
            {raiseCount > 1 ? ` — talking about ${raiseCount} companies` : ""}
          </h1>
          <p>
            {partner.title ?? "Partner"}
            {partner.firm?.firm_name ? ` · ${partner.firm.firm_name}` : ""}.
            Each raise has its own status. There is no single overall status.
          </p>
        </div>
      </div>

      <div className="raise-cards">
        {partner.campaign_links.length === 0 ? (
          <div className="raise-card">
            <h3>No raise yet</h3>
            <p className="faint">Add them from Company or Find a Match.</p>
          </div>
        ) : (
          partner.campaign_links.map((l) => (
            <div key={l.campaign_partner_id} className="raise-card">
              <h3>{l.campaign_name ?? "Raise"}</h3>
              <div>
                <span className="badge b-progress">
                  {l.status_code ?? "no status"} {l.status_label ?? ""}
                </span>
              </div>
              <p className="faint" style={{ marginTop: 8 }}>
                {l.days_since_last_contact == null
                  ? "No contact yet"
                  : `${l.days_since_last_contact}d since last contact`}
              </p>
              <RaiseStatusForm
                campaignPartnerId={l.campaign_partner_id}
                currentCode={l.status_code}
              />
              <div className="btn-row">
                <Link className="btn" href={`/company?c=${l.campaign_id}`}>
                  Open raise
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Timeline — person, not raise</h2>
          <p className="sub">Events stay on the person. Status is per raise.</p>
          <div className="timeline">
            {partner.recent_events.length === 0 ? (
              <p className="sub">No contact_events yet.</p>
            ) : (
              partner.recent_events.map((e) => (
                <div key={e.id} className="tl-item">
                  <div className="faint">
                    {e.event_at
                      ? new Date(e.event_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })
                      : "—"}
                  </div>
                  <div className="tl-dot" />
                  <div>
                    <strong>{e.channel ?? e.direction ?? "event"}</strong>
                    <div className="faint">{e.summary}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <h2>From the encyclopaedia</h2>
          <p className="sub">Read-only. This desk does not write back to Forge Capital.</p>
          <table>
            <tbody>
              <tr>
                <th>Firm</th>
                <td>
                  {partner.firm?.id != null ? (
                    <Link href={`/firm/${partner.firm.id}`}>{partner.firm.firm_name}</Link>
                  ) : (
                    partner.firm?.firm_name ?? "—"
                  )}
                </td>
              </tr>
              <tr><th>Email</th><td>{partner.email ?? "—"}</td></tr>
              <tr><th>Thesis</th><td>{partner.firm?.thesis_summary ?? "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
