import Link from "next/link";
import { RememberCall } from "../../call/RememberCall";
import { findDeskMeeting } from "@/lib/queries/find-meeting";
import { loadLiveCorrespondence } from "@/lib/queries/live-correspondence";
import { mailStory } from "@/lib/queries/mail-story";
import {
  decodeMailText,
  loadMeetingNotes,
} from "@/lib/queries/meeting-brief";
import {
  displayPersonName,
  firmBlurb,
  personBlurb,
  resolveMeetingBook,
} from "@/lib/queries/resolve-meeting";
import { linkedInBlurb, linkedInBriefForPerson } from "@/lib/capital/person-linkedin";
import { inferMandatesForMeeting } from "@/lib/desk/mandate-state";
import { CallDrafts } from "../CallDrafts";
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

  const book = await resolveMeetingBook(meeting);
  const linkedIn = await linkedInBriefForPerson({
    personId: book.personId,
    name: displayPersonName(book.personName, book.personEmail) || book.personName,
    email: book.personEmail,
    firmName: book.firmName,
    firmDomain: book.firmDomain,
    roleTitle: book.personRole,
    notes: book.personNotes,
    linkedinUrl: book.linkedinUrl,
  });
  const correspondence = await loadLiveCorrespondence({
    emails: [
      ...book.searchedEmails,
      ...(book.personEmail ? [book.personEmail] : []),
    ],
    personId: book.personId,
  });
  const notes = loadMeetingNotes()[meeting.id]?.text ?? "";
  const who =
    displayPersonName(book.personName ?? meeting.partner_name, book.personEmail) ||
    meeting.title;
  const firmName = book.firmName ?? meeting.firm_name;
  const where = inferMandatesForMeeting(meeting, null);
  const story = mailStory(correspondence.mail, correspondence.searched);
  const canDraft =
    Boolean(book.personId) &&
    Boolean(book.personEmail) &&
    book.personEmailState === "verified" &&
    !book.personDnc;
  const blockedReason = canDraft
    ? null
    : book.personDnc
      ? "Do not contact."
      : !book.personId
        ? "The calendar name did not match a unique book row, so drafts stay blocked."
        : !book.personEmail
          ? "No email on this person."
          : `Email is ${book.personEmailState ?? "unknown"} — verify first.`;

  return (
    <div className="wrap">
      <RememberCall id={meeting.id} />
      <div className="page-head">
        <div>
          <h1>
            {who}
            {firmName ? ` · ${firmName}` : ""}
          </h1>
          <p>{when(meeting.event_at)}</p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/raise-calendar" className="btn">
            Calendar
          </Link>
          {book.personId ? (
            <Link href={`/person/${book.personId}`} className="btn btn-primary">
              Open person
            </Link>
          ) : (
            <Link
              className="btn btn-primary"
              href={`/discover?q=${encodeURIComponent(who ?? "")}`}
            >
              File onto the book
            </Link>
          )}
          {meeting.htmlLink ? (
            <a className="btn" href={meeting.htmlLink} target="_blank" rel="noreferrer">
              Open in Google
            </a>
          ) : null}
          <Link href="/today" className="btn">
            Today
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="blurb">
            <h2>{who ?? "The person"}</h2>
            <p>{personBlurb(book)}</p>
            {book.candidates.length > 0 ? (
              <ul className="sub" style={{ paddingLeft: 18, marginTop: 8 }}>
                {book.candidates.map((c) => (
                  <li key={c.personId}>
                    <Link href={`/person/${c.personId}`}>{c.personName}</Link>
                    {c.firmName ? ` · ${c.firmName}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="blurb">
            <h2>
              {book.firmId ? (
                <Link href={`/firm/${book.firmId}`}>{firmName ?? "The firm"}</Link>
              ) : (
                firmName ?? "The firm"
              )}
            </h2>
            <p>{firmBlurb(book)}</p>
          </div>
          <div className="blurb">
            <h2>LinkedIn</h2>
            <p>{linkedInBlurb(linkedIn)}</p>
            {linkedIn.url ? (
              <p className="sub" style={{ paddingLeft: 0, marginTop: 8 }}>
                <a href={linkedIn.url} target="_blank" rel="noreferrer">
                  Open profile
                </a>
              </p>
            ) : null}
          </div>
          <div className="blurb">
            <h2>What we have said so far</h2>
            <p>{story}</p>
            {correspondence.error ? (
              <p className="faint" style={{ marginTop: 8 }}>
                {correspondence.error}
              </p>
            ) : null}
          </div>
          <div style={{ padding: "4px 16px 16px" }}>
            <WhereWeAre items={where} />
          </div>
        </div>

        <div className="card">
          <h2>Your notes</h2>
          <p className="sub">
            One box for this call. Save here. Thank-you and follow-up create
            Gmail drafts only.
          </p>
          <div style={{ padding: "0 16px 16px" }}>
            <MeetingNotes meetingId={meeting.id} initial={notes} />
            <CallDrafts
              meetingId={meeting.id}
              canDraft={canDraft}
              blockedReason={blockedReason}
            />
            <h2>Paste the transcript</h2>
            <p className="sub" style={{ paddingLeft: 0 }}>
              One blob. Propose first. Confirm creates Gmail drafts only.
            </p>
            <PasteNotes />
          </div>
          {book.programmes.length > 0 ? (
            <>
              <h2>On the desk</h2>
              <table>
                <tbody>
                  {book.programmes.map((p) => (
                    <tr key={p.code}>
                      <td>
                        {p.code} · {p.label}
                      </td>
                      <td>{p.stage || "no stage"}</td>
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
          Newest first, from Gmail and the book
          {correspondence.searched.length
            ? ` · searched ${correspondence.searched.join(", ")}`
            : ""}
          {correspondence.mail.length === 0
            ? `. ${story}`
            : `. ${correspondence.mail.length} message${correspondence.mail.length === 1 ? "" : "s"}.`}
        </p>
        {correspondence.mail.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Subject and opening</th>
              </tr>
            </thead>
            <tbody>
              {correspondence.mail.map((m) => {
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
