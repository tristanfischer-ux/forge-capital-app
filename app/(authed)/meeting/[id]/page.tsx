import Link from "next/link";
import { notFound } from "next/navigation";
import { Hint } from "../../Hint";
import { readDeskWeekCache } from "@/lib/queries/desk-calendar";
import { skipRaiseName } from "@/lib/desk/status-map";
import { getPartnerProfile } from "@/lib/queries/partner-profile";

export const dynamic = "force-dynamic";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const raw = decodeURIComponent((await params).id);
  const cache = await readDeskWeekCache();
  const meeting =
    cache.meetings.find((m) => m.id === raw || m.id === `gcal:${raw}` || raw.endsWith(m.id)) ??
    null;
  if (!meeting) notFound();

  const partner = meeting.partner_id
    ? await getPartnerProfile(meeting.partner_id)
    : null;
  const raises = (partner?.campaign_links ?? []).filter(
    (l) => !skipRaiseName(l.campaign_name),
  );

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{meeting.title ?? "Meeting"}</h1>
          <p>{when(meeting.event_at)}</p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/raise-calendar" className="btn">Back to calendar</Link>
          <Link href="/today" className="btn">Today</Link>
        </div>
      </div>

      {meeting.unmatched ? (
        <div className="warn-banner">
          <Hint label="This person is not yet a unique email on the raise tracker. The meeting is still real — we just cannot open a Person page until they are filed.">
            <strong>Not on the tracker yet.</strong>
          </Hint>{" "}
          We have a name or a calendar title, but no unique email match in
          Forge Capital. Use search, or add them from Company.
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <h2>What this is</h2>
          <p className="sub">Pulled from your Google Calendar. Nothing here was invented.</p>
          <table>
            <tbody>
              <tr>
                <th>When</th>
                <td>{when(meeting.event_at)}</td>
              </tr>
              <tr>
                <th>Who</th>
                <td>
                  {meeting.partner_id ? (
                    <Link href={`/person/${meeting.partner_id}`}>
                      {meeting.partner_name ?? "Open person"}
                    </Link>
                  ) : (
                    meeting.partner_name ?? meeting.title ?? "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>
                  <Hint label="The company you are raising for, if we could read it from the title.">
                    Raise
                  </Hint>
                </th>
                <td>
                  {meeting.campaign_id ? (
                    <Link href={`/company?c=${meeting.campaign_id}`}>
                      {meeting.campaign_name}
                    </Link>
                  ) : (
                    meeting.campaign_name ?? "Not tied to a raise yet"
                  )}
                </td>
              </tr>
              <tr>
                <th>Firm</th>
                <td>
                  {partner?.firm?.id != null ? (
                    <Link href={`/firm/${partner.firm.id}`}>{partner.firm.firm_name}</Link>
                  ) : (
                    meeting.firm_name ?? "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>Attendees</th>
                <td>
                  {(meeting.attendee_emails ?? []).length
                    ? meeting.attendee_emails?.join(", ")
                    : "No guest list on the calendar invite"}
                </td>
              </tr>
            </tbody>
          </table>
          {meeting.notes || meeting.summary ? (
            <div style={{ padding: "0 16px 16px" }}>
              <h2>Calendar notes</h2>
              <p className="sub" style={{ paddingLeft: 0 }}>
                {(meeting.notes || meeting.summary || "").slice(0, 1200)}
              </p>
            </div>
          ) : (
            <p className="sub">No description on the calendar event.</p>
          )}
        </div>
        <div className="card">
          <h2>On the desk</h2>
          {partner ? (
            <>
              <p className="sub">
                {partner.name} is on {raises.length} raise
                {raises.length === 1 ? "" : "s"}.
              </p>
              <table>
                <tbody>
                  {raises.map((l) => (
                    <tr key={l.campaign_partner_id}>
                      <td>
                        <Link href={`/company?c=${l.campaign_id}`}>{l.campaign_name}</Link>
                      </td>
                      <td>{l.status_code ?? "no status"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="btn-row" style={{ padding: 16 }}>
                <Link className="btn btn-primary" href={`/person/${partner.id}`}>
                  Open the full person page
                </Link>
              </div>
            </>
          ) : (
            <p className="sub">
              No tracker row yet. Search for the name at the top, or open
              Review if this came from the spreadsheet import.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
