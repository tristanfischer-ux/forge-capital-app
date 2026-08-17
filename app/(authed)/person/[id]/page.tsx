import Link from "next/link";
import { notFound } from "next/navigation";
import {
  badgeClassFor,
  labelFor,
  skipRaiseName,
} from "@/lib/desk/status-map";
import { getPartnerProfile } from "@/lib/queries/partner-profile";
import { RaiseStatusForm } from "../../partner/[id]/RaiseStatusForm";
import { Hint } from "../../Hint";

export const dynamic = "force-dynamic";

function eventLabel(channel: string | null, direction: string | null): string {
  if (channel === "gmail" && direction === "inbound") return "They emailed you";
  if (channel === "gmail" && direction === "outbound") return "You emailed them";
  if (channel === "google_meet" || channel === "meeting" || channel === "teams" || channel === "zoom") {
    return "Meeting";
  }
  if (channel === "manual") return "Note you logged";
  return channel ?? direction ?? "Event";
}

export default async function DeskPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(id)) notFound();
  const partner = await getPartnerProfile(id);
  if (!partner) notFound();

  const raiseLinks = partner.campaign_links.filter(
    (l) => !skipRaiseName(l.campaign_name),
  );
  const raiseCount = raiseLinks.length;

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{partner.name ?? "Unnamed partner"}</h1>
          <p>
            {partner.title ?? "Partner"}
            {partner.firm?.firm_name ? ` · ${partner.firm.firm_name}` : ""}.
            {raiseCount === 0
              ? " Not on any live raise yet."
              : raiseCount === 1
                ? " On one raise — that is one tracker row."
                : ` On ${raiseCount} raises at once. Each raise has its own status.`}
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/person" className="btn">Find someone else</Link>
          {partner.firm?.id != null ? (
            <Link href={`/firm/${partner.firm.id}`} className="btn">
              Open {partner.firm.firm_name}
            </Link>
          ) : null}
          <Link href="/today" className="btn">Back to Today</Link>
        </div>
      </div>

      <div className="raise-cards">
        {raiseLinks.length === 0 ? (
          <div className="raise-card">
            <h3>Not on a raise yet</h3>
            <p className="faint">
              They are in the Forge Capital directory, but they are not on
              SkySails, FishFrom, Odysseus, or another live raise. Use
              Company to add them, or go back via the crumbs above.
            </p>
          </div>
        ) : (
          raiseLinks.map((l) => (
            <div key={l.campaign_partner_id} className="raise-card">
              <h3>{l.campaign_name ?? "Raise"}</h3>
              <div>
                <span className={`badge ${badgeClassFor(l.status_code)}`}>
                  {l.status_code ?? "no status"}{" "}
                  {labelFor(l.status_code) ?? l.status_label ?? ""}
                </span>
              </div>
              <p className="faint" style={{ marginTop: 8 }}>
                {l.days_since_last_contact == null
                  ? "No contact logged yet"
                  : `${l.days_since_last_contact}d since last contact`}
              </p>
              <RaiseStatusForm
                campaignPartnerId={l.campaign_partner_id}
                currentCode={l.status_code}
              />
              <div className="btn-row">
                <Hint label="Opens the Company tab — the tracker of everyone on this raise, not a new email.">
                  <Link className="btn" href={`/company?c=${l.campaign_id}`}>
                    Open the {l.campaign_name} tracker
                  </Link>
                </Hint>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>What has happened</h2>
          <p className="sub">
            Emails, meetings and notes for this person. Status still lives
            on each raise card above.
          </p>
          <div className="timeline">
            {partner.recent_events.length === 0 ? (
              <p className="sub">Nothing logged yet — no email or meeting on file.</p>
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
                    <strong>{eventLabel(e.channel, e.direction)}</strong>
                    <div className="faint">{e.summary}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <h2>From Forge Capital</h2>
          <p className="sub">
            Read-only directory. The raise desk does not write back here.
          </p>
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
