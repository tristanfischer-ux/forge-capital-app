import Link from "next/link";
import { skipRaiseName } from "@/lib/desk/status-map";
import { findDeskMeeting } from "@/lib/queries/find-meeting";
import {
  decodeMailText,
  loadMeetingBriefs,
  loadMeetingNotes,
  sortCorrespondenceNewestFirst,
} from "@/lib/queries/meeting-brief";
import { getPartnerProfile } from "@/lib/queries/partner-profile";
import { inferMandatesForMeeting } from "@/lib/desk/mandate-state";
import { MeetingNotes } from "../../MeetingNotes";
import { PasteNotes } from "../../PasteNotes";
import { WhereWeAre } from "../../WhereWeAre";

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
  const meeting = await findDeskMeeting(raw);
  if (!meeting) {
    return (
      <div className="wrap">
        <div className="page-head">
          <div>
            <h1>This slot is not on the book</h1>
            <p>
              Today and Calendar read live Google Calendar. This briefing id
              was not in that week. Open Calendar and click the block again.
            </p>
          </div>
          <div className="btn-row" style={{ margin: 0 }}>
            <Link href="/raise-calendar" className="btn btn-primary">
              Calendar
            </Link>
            <Link href="/today" className="btn">
              Today
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const briefs = loadMeetingBriefs();
  const filed = briefs[meeting.id] ?? briefs[raw] ?? null;
  const partnerId = meeting.partner_id ?? filed?.partner_id ?? null;
  const partner =
    typeof partnerId === "number" ? await getPartnerProfile(partnerId) : null;
  const raises = (partner?.campaign_links ?? []).filter(
    (l) => !skipRaiseName(l.campaign_name),
  );
  const notes = loadMeetingNotes()[meeting.id]?.text ?? "";
  const brief = filed?.brief ?? {};
  const mail = sortCorrespondenceNewestFirst(filed?.correspondence ?? []);

  const firmName = partner?.firm?.firm_name ?? filed?.firm_name ?? meeting.firm_name;
  const firmId = partner?.firm?.id ?? filed?.firm_id ?? null;
  const raiseName = filed?.campaign_name ?? meeting.campaign_name;
  const raiseId = filed?.campaign_id ?? meeting.campaign_id;
  const where = inferMandatesForMeeting(meeting, filed);

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>
            {meeting.partner_name ?? meeting.title}
            {firmName ? ` · ${firmName}` : ""}
          </h1>
          <p>{when(meeting.event_at)}</p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/raise-calendar" className="btn">Calendar</Link>
          {partnerId ? (
            <Link href={`/person/${partnerId}`} className="btn btn-primary">
              Open person
            </Link>
          ) : (
            <Link
              className="btn btn-primary"
              href={`/discover?q=${encodeURIComponent(meeting.partner_name ?? meeting.title ?? "")}`}
            >
              File onto the book
            </Link>
          )}
          <Link
            href={`/notes?title=${encodeURIComponent(meeting.partner_name ?? meeting.title ?? "Call")}`}
            className="btn"
          >
            Log this call
          </Link>
          {meeting.htmlLink ? (
            <a className="btn" href={meeting.htmlLink} target="_blank" rel="noreferrer">
              Open in Google
            </a>
          ) : null}
          <Link href="/today" className="btn">Today</Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Cheat sheet</h2>
          <p className="sub">
            Built from the invite, Forge Capital, and the mail we actually
            found. Nothing here is invented.
          </p>
          <table>
            <tbody>
              <tr>
                <th>When</th>
                <td>{when(meeting.event_at)}</td>
              </tr>
              <tr>
                <th>Who</th>
                <td>
                  {partnerId ? (
                    <Link href={`/person/${partnerId}`}>
                      {meeting.partner_name ?? partner?.name}
                    </Link>
                  ) : (
                    meeting.partner_name ?? meeting.title
                  )}
                  {meeting.attendee_emails?.[0] ? (
                    <div className="faint">{meeting.attendee_emails[0]}</div>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th>Firm</th>
                <td>
                  {firmId ? (
                    <Link href={`/firm/${firmId}`}>{firmName}</Link>
                  ) : (
                    firmName ?? "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>Raise</th>
                <td>
                  {raiseId ? (
                    <Link href={`/company?c=${raiseId}`}>{raiseName}</Link>
                  ) : (
                    brief.raise ?? "Not a named raise — see why this call, below"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ padding: "4px 16px 16px" }}>
            {brief.how_they_arrived ? (
              <>
                <h2>How they got here</h2>
                <p className="sub" style={{ paddingLeft: 0 }}>{brief.how_they_arrived}</p>
              </>
            ) : null}
            {brief.who ? (
              <>
                <h2>Who they are</h2>
                <p className="sub" style={{ paddingLeft: 0 }}>{brief.who}</p>
              </>
            ) : null}
            {brief.firm ? (
              <>
                <h2>The firm</h2>
                <p className="sub" style={{ paddingLeft: 0 }}>{brief.firm}</p>
              </>
            ) : null}
            {brief.why_this_call ? (
              <>
                <h2>What this call is about</h2>
                <p className="sub" style={{ paddingLeft: 0 }}>{brief.why_this_call}</p>
              </>
            ) : null}
            <WhereWeAre items={where} />
            {brief.email_story ? (
              <>
                <h2>Who emailed whom</h2>
                <p className="sub" style={{ paddingLeft: 0 }}>{brief.email_story}</p>
              </>
            ) : null}
            {brief.focus && brief.focus.length > 0 ? (
              <>
                <h2>Hit these</h2>
                <ul className="sub" style={{ paddingLeft: 18 }}>
                  {brief.focus.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Your notes</h2>
          <p className="sub">Saved on this meeting. If they are on a raise, the note is also logged on that row.</p>
          <div style={{ padding: "0 16px 16px" }}>
            <MeetingNotes meetingId={meeting.id} initial={notes} />
            <h2>Paste the transcript</h2>
            <p className="sub" style={{ paddingLeft: 0 }}>
              One blob. Propose first. Confirm creates Gmail drafts only.
            </p>
            <PasteNotes />
          </div>
          {raises.length > 0 ? (
            <>
              <h2>On the desk</h2>
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
            </>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Correspondence</h2>
        <p className="sub">
          Newest first. Click a row to read the letter — the full text
          if Gmail is connected, otherwise the opening we have, plus a
          link into Gmail.
          {mail.length === 0
            ? " None found — this looks like a Calendly inbound with no prior thread."
            : ` ${mail.length} message${mail.length === 1 ? "" : "s"}.`}
        </p>
        {mail.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Subject and opening</th>
              </tr>
            </thead>
            <tbody>
              {mail.map((m) => {
                const href = `/meeting/${encodeURIComponent(meeting.id)}/mail/${encodeURIComponent(m.id)}`;
                return (
                  <tr key={m.id} className="clickable">
                    <td>
                      <Link href={href}>
                        {m.date
                          ? new Date(m.date).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </Link>
                    </td>
                    <td>
                      <Link href={href}>{m.from}</Link>
                      <div className="faint">to {m.to}</div>
                    </td>
                    <td>
                      <Link href={href}>{m.subject}</Link>
                      <div className="faint">{decodeMailText(m.snippet)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
