import Link from "next/link";
import { getCapitalBookCounts } from "@/lib/queries/capital-book";
import { getCapitalHeartbeat } from "@/lib/queries/capital-heartbeat";
import { getDeskToday, type DeskMeeting, type DeskReply } from "@/lib/queries/desk-today";
import {
  briefForMeetingId,
  correspondenceLooksCanceled,
  decodeMailText,
  loadMeetingBriefs,
  mailDirection,
  pickCorrespondence,
  formatMailSnippet,
  type MeetingCorrespondence,
} from "@/lib/queries/meeting-brief";
import {
  inferMandatesForMeeting,
  proposeTodayJob,
  todayDigest,
} from "@/lib/desk/mandate-state";
import { openLoops } from "@/lib/desk/notes-to-action";
import { getCorpusTodayStats } from "@/lib/queries/corpus-today";
import { Hint } from "../Hint";
import { ReplyBox } from "../ReplyBox";
import { WhereWeAre } from "../WhereWeAre";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function meetingHref(id: string): string {
  return `/meeting/${encodeURIComponent(id)}`;
}

function invitePurpose(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/_{8,}[\s\S]*$/m, "")
    .replace(/Microsoft Teams meeting[\s\S]*/i, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 24) return null;
  return formatMailSnippet(cleaned, 280);
}

function replyAsMail(r: DeskReply): MeetingCorrespondence {
  return {
    id: r.id,
    threadId: r.gmail_thread_id ?? undefined,
    from: r.from ?? r.partner_name ?? "Unknown",
    to: "Tristan Fischer",
    subject: r.summary ?? "",
    date: r.event_at,
    snippet: r.preview ?? "",
  };
}

function repliesForMeeting(meeting: DeskMeeting, replies: DeskReply[]): MeetingCorrespondence[] {
  const keys: string[] = [];
  if (meeting.partner_name) keys.push(meeting.partner_name.toLowerCase());
  if (meeting.firm_name) keys.push(meeting.firm_name.toLowerCase());
  const title = (meeting.title ?? "").toLowerCase();
  for (const phrase of ["medina", "gareth stockman", "raul henriquez"]) {
    if (title.includes(phrase)) keys.push(phrase);
  }
  if (keys.length === 0) return [];
  return replies
    .filter((r) => {
      const blob = `${r.partner_name ?? ""} ${r.from ?? ""} ${r.summary ?? ""}`.toLowerCase();
      return keys.some((k) => blob.includes(k));
    })
    .map(replyAsMail);
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_connected?: string }>;
}) {
  const { gmail_connected } = await searchParams;
  const [data, heartbeat, book, corpus] = await Promise.all([
    getDeskToday(),
    getCapitalHeartbeat(),
    getCapitalBookCounts(),
    getCorpusTodayStats(),
  ]);
  const briefs = loadMeetingBriefs();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const firstBlock = data.blocks[0];
  const unmatched = data.meetings.filter((m) => m.unmatched && !m.canceled).length;
  const canceledMeetings = data.meetings.filter((m) => m.canceled);
  const job = proposeTodayJob({
    meetings: data.meetings,
    replies: data.replies,
    stuckCount: corpus.quietCount,
    approvalCount: corpus.signOffCount,
    canceledMeetings,
  });
  const digest = todayDigest({
    meetings: data.meetings,
    replies: data.replies,
    approvalCount: data.approvalCount,
  });

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Today — {today}</h1>
          <p>
            Next meetings first — what each one is, and a bit of the mail.
            Then the queue. Hover a number if the jargon is unclear.
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href="/call" className="btn btn-primary">Current Call</Link>
          <Link href="/chasers" className="btn">Chasers</Link>
        </div>
      </div>

      {gmail_connected === "1" ? (
        <div className="note" style={{ marginBottom: 16 }}>
          Google is connected. You are on the Raise desk, not the old
          Outreach pipeline.
        </div>
      ) : null}

      <div className="note" style={{ marginBottom: 16 }}>
        {book.configured ? (
          <>
            Shared book: {book.firms.toLocaleString("en-GB")} firms,{" "}
            {book.people.toLocaleString("en-GB")} people,{" "}
            {book.participations.toLocaleString("en-GB")} programme rows.
            {book.pendingReview > 0
              ? ` ${book.pendingReview} still in review.`
              : " Quarantine is empty."}{" "}
          </>
        ) : (
          <>Shared book is not wired yet. </>
        )}
        {heartbeat.configured && heartbeat.staleFeeds.length > 0
          ? `Heartbeat stale — ${heartbeat.staleFeeds.join(", ")}.`
          : null}
      </div>

      <div className="job-box">
        <div className="k">What to do</div>
        <h2>{job.title}</h2>
        {digest.length > 0 ? (
          <ul className="digest">
            {digest.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p>{job.body}</p>
        <Link href={job.href} className="btn btn-primary">{job.cta}</Link>
        {openLoops().length > 0 ? (
          <ul className="digest" style={{ marginTop: 12 }}>
            {openLoops().map((l) => (
              <li key={l.text + l.due}>
                Open loop · {l.due}: {l.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="tiles">
        <Hint label="Meetings from your Google Calendar in the next week. Unmatched means the guest is not a unique email on the book yet — click the meeting for the briefing.">
          <a href="#meetings" className="tile" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="k">Meetings this week</div>
            <div className="n">{data.meetings.length}</div>
            <div className="s">
              {unmatched} not yet on the book
            </div>
          </a>
        </Hint>
        <Hint label="Inbound emails from the last week that look like real people, not newsletters.">
          <a href="#replies" className="tile" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="k">Replies this week</div>
            <div className="n">{data.replies.length}</div>
            <div className="s">inbound, listed below</div>
          </a>
        </Hint>
        <Hint label="People on the shared book whose last dated touch is more than ten days ago. Open Chasers to draft a polite follow-up — nothing sends until the address is verified.">
          <Link href="/chasers" className="tile warn" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="k">Quiet ≥ 10 days</div>
            <div className="n">{corpus.quietCount}</div>
            <div className="s">all programmes · open Chasers</div>
          </Link>
        </Hint>
        <Hint label="Anyone approached on more than one programme in the last 21 days. The badge is the warning — open the row before you draft.">
          <Link href="/collisions" className="tile bad" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="k">Collisions</div>
            <div className="n">{corpus.collisionCount}</div>
            <div className="s">21-day cross-programme</div>
          </Link>
        </Hint>
      </div>

      {firstBlock ? (
        <div className="block-banner">
          <strong>Do not send — {firstBlock.partner_name ?? `partner ${firstBlock.partner_id}`}</strong>
          {firstBlock.reason ? `. ${firstBlock.reason}` : ""}. A person-level
          block beats any campaign status.
        </div>
      ) : null}

      {corpus.collisionCount > 0 ? (
        <div className="warn-banner">
          <strong>Collisions:</strong> {corpus.collisionCount} people approached on more
          than one programme in 21 days. Check the badge on Send before you draft.{" "}
          <Link href="/collisions">Open the table</Link>.
        </div>
      ) : null}

      <div className="card" id="meetings" style={{ marginBottom: 16 }}>
        <h2>Next meetings</h2>
        <p className="sub">
          What the slot is, then a little of the correspondence. Click a
          card for the full cheat sheet and the rest of the thread.
        </p>
        {data.meetings.length === 0 ? (
          <p className="sub">No meetings in the next 7 days.</p>
        ) : (
          <div className="meet-list">
            {data.meetings.map((m) => {
              const filed = briefForMeetingId(briefs, m.id);
              const filedMail = filed?.correspondence ?? [];
              const mail = pickCorrespondence(
                filedMail.length > 0 ? filedMail : repliesForMeeting(m, data.replies),
                2,
              );
              const canceled =
                Boolean(m.canceled) ||
                /canceled|cancelled/i.test(`${m.title ?? ""} ${m.summary ?? ""}`) ||
                correspondenceLooksCanceled(filedMail) ||
                correspondenceLooksCanceled(mail);
              const where = inferMandatesForMeeting(m, filed);
              const about =
                filed?.brief.why_this_call ??
                filed?.brief.how_they_arrived ??
                invitePurpose(m.notes) ??
                (m.title && m.title !== (m.partner_name ?? "")
                  ? m.title.trim()
                  : null);
              const who = (m.partner_name ?? m.title ?? "Meeting").trim();
              const firm = m.firm_name ?? filed?.firm_name;
              const showFirm =
                Boolean(firm) && !who.toLowerCase().includes((firm ?? "").toLowerCase());
              const raise = m.campaign_name ?? filed?.campaign_name;
              return (
                <Link
                  key={m.id}
                  href={meetingHref(m.id)}
                  className={canceled ? "meet-item canceled" : "meet-item"}
                >
                  <div className="when">
                    <span>{when(m.event_at)}</span>
                    {canceled ? <span className="badge b-dead">Canceled</span> : null}
                    {raise ? <span className="badge b-raise">{raise}</span> : null}
                    {!raise && m.unmatched ? (
                      <span className="badge b-pending">Not on the tracker</span>
                    ) : null}
                  </div>
                  <h3>
                    {who}
                    {showFirm ? ` · ${firm}` : ""}
                  </h3>
                  {about && about.trim() !== who ? (
                    <p className="about">{about}</p>
                  ) : null}
                  {canceled ? (
                    <p className="about">
                      Do not prep as live. Open the briefing if you want to
                      reschedule from the thread.
                    </p>
                  ) : null}
                  <WhereWeAre items={where} compact />
                  {mail.length > 0 ? (
                    <ul className="meet-mail">
                      {mail.map((c) => (
                        <li key={c.id}>
                          <div className="dir">{mailDirection(c)}</div>
                          {c.subject ? <div className="subj">{c.subject}</div> : null}
                          {c.snippet ? (
                            <div className="snip">{formatMailSnippet(c.snippet)}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="about faint" style={{ marginTop: 8 }}>
                      No correspondence on file for this slot.
                    </p>
                  )}
                  <div className="meet-more">
                    Open the briefing
                    {m.unmatched ? " · file onto the book" : ""}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" id="replies" style={{ marginBottom: 16 }}>
        <h2>Replies this week</h2>
        <p className="sub">
          Inbound from the last week. Reply parks a Gmail draft. Sending is
          two clicks and never automatic.
        </p>
        {data.replies.length === 0 ? (
          <p className="sub">No inbound rows in the last week.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>From</th>
                <th>Programme</th>
                <th>Subject and opening</th>
              </tr>
            </thead>
            <tbody>
              {data.replies.map((r) => {
                const email = r.from?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "";
                return (
                  <tr key={r.id}>
                    <td>
                      {r.event_at
                        ? new Date(r.event_at).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td>
                      {r.partner_id ? (
                        <Link href={`/person/${r.partner_id}`}>{r.partner_name}</Link>
                      ) : (
                        r.partner_name ?? r.from ?? "—"
                      )}
                    </td>
                    <td>
                      <span className="badge b-raise">{r.campaign_name ?? "—"}</span>
                    </td>
                    <td>
                      <div>{r.summary}</div>
                      {r.preview ? (
                        <div className="faint">{decodeMailText(r.preview).slice(0, 180)}</div>
                      ) : null}
                      {email ? (
                        <ReplyBox to={email} subject={r.summary ?? ""} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Quiet on the book</h2>
          <p className="sub">
            Last dated touch more than seven days ago, grouped by programme.
            A chaser is a Gmail draft. Addresses still have to be verified.
          </p>
          {corpus.quietByMandate.length === 0 ? (
            <p className="sub">No dated quiet rows on the shared book.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Programme</th>
                  <th>Quiet</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {corpus.quietByMandate.map((g) => (
                  <tr key={g.code}>
                    <td>
                      {g.code} · {g.label}
                    </td>
                    <td>{g.count}</td>
                    <td>
                      <Link href={`/chasers?code=${g.code}`}>Filter {g.code}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Verify before you draft</h2>
          <p className="sub">
            Rule 13: a named person and a NeverBounce-verified address.
            {corpus.unverifiedCount > 0
              ? ` ${corpus.unverifiedCount.toLocaleString("en-GB")} people on a programme are still unverified.`
              : " No unverified addresses in the working set."}
          </p>
          <div className="btn-row">
            <Link href="/verify-book" className="btn btn-primary">
              Verify queue
            </Link>
            <Link href="/chasers?view=unverified" className="btn">
              Unverified on Chasers
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
