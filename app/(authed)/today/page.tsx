import Link from "next/link";
import { getCapitalBookCounts } from "@/lib/queries/capital-book";
import { getCapitalHeartbeat } from "@/lib/queries/capital-heartbeat";
import { getDeskToday, type DeskMeeting, type DeskReply } from "@/lib/queries/desk-today";
import {
  briefForMeetingId,
  correspondenceLooksCanceled,
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
import { Hint } from "../Hint";
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
  const [data, heartbeat, book] = await Promise.all([
    getDeskToday(),
    getCapitalHeartbeat(),
    getCapitalBookCounts(),
  ]);
  const briefs = loadMeetingBriefs();
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const firstBlock = data.blocks[0];
  const firstDouble = data.doubleAsks[0];
  const unmatched = data.meetings.filter((m) => m.unmatched && !m.canceled).length;
  const canceledMeetings = data.meetings.filter((m) => m.canceled);
  const job = proposeTodayJob({
    meetings: data.meetings,
    replies: data.replies,
    stuckCount: data.stuckCount,
    approvalCount: data.approvalCount,
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
          <Link href="/desk-review" className="btn">Review queue</Link>
          <Link href="/raise-excel" className="btn">Excel snapshot</Link>
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
            {book.participations.toLocaleString("en-GB")} raise rows.
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
        <Hint label="Meetings from your Google Calendar in the next week. Unmatched means the guest is not a unique email on the raise tracker yet — click the meeting to see who it is.">
          <div className="tile">
            <div className="k">Meetings</div>
            <div className="n">{data.meetings.length}</div>
            <div className="s">
              {unmatched} not yet on the tracker
            </div>
          </div>
        </Hint>
        <Hint label="Inbound emails from the last week that look like real people, not newsletters. Click Inbox to read the first lines.">
          <div className="tile">
            <div className="k">Replies</div>
            <div className="n">{data.replies.length}</div>
            <div className="s">inbound this week</div>
          </div>
        </Hint>
        <Hint label="People sitting at +0 (not emailed), +3 (email sent) or +5 (follow-up sent) whose last dated touch is more than a week ago. Grouped by raise in the table below.">
          <div className="tile warn">
            <div className="k">Quiet &gt; 7 days</div>
            <div className="n">{data.stuckCount}</div>
            <div className="s">no recent dated touch</div>
          </div>
        </Hint>
        <Hint label="The same person is live on two or more raises at once. Open the person before you queue another email so you do not ask twice.">
          <div className="tile bad">
            <div className="k">On two raises</div>
            <div className="n">{data.doubleAskCount}</div>
            <div className="s">same person, two live raises</div>
          </div>
        </Hint>
        <Hint label="People the counterpart already approved (+1) or for whom a letter exists (+2). This is not a send button. Work one raise as a wave from Company, not twenty names from here.">
          <div className="tile">
            <div className="k">Letters waiting</div>
            <div className="n">{data.approvalCount}</div>
            <div className="s">approved or drafted — not sent</div>
          </div>
        </Hint>
      </div>

      {firstBlock ? (
        <div className="block-banner">
          <strong>Do not send — {firstBlock.partner_name ?? `partner ${firstBlock.partner_id}`}</strong>
          {firstBlock.reason ? `. ${firstBlock.reason}` : ""}. A person-level
          block beats any campaign status.
        </div>
      ) : null}

      {firstDouble ? (
        <div className="warn-banner">
          <strong>On two raises:</strong>{" "}
          <Link href={`/person/${firstDouble.partner_id}`}>
            {firstDouble.partner_name ?? firstDouble.firm_name}
          </Link>{" "}
          is on {firstDouble.raises.map((r) => `${r.campaign_name} ${r.status_code ?? ""}`).join(" · ")}.
          Open the person before you queue a send. {data.doubleAskCount} people in this state.
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
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
                  <div className="meet-more">Open the briefing</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Letters waiting</h2>
          <p className="sub">
            This is not a send list. +2 means a letter already exists — open
            it. +1 means the counterpart said yes and nobody has written the
            email yet. Do that as a wave on the Company tab, not by picking
            names at random here.
          </p>
          {(() => {
            const real = data.approvals.filter(
              (a) =>
                a.partner_name &&
                !/general enquir/i.test(a.partner_name),
            );
            const drafted = real.filter((a) => a.status_code === "+2");
            const approved = real.filter((a) => a.status_code === "+1");
            const byRaise = new Map<string, { name: string; id: string | null; n: number }>();
            for (const a of approved) {
              const key = a.campaign_id ?? a.campaign_name ?? "—";
              const cur = byRaise.get(key) ?? {
                name: a.campaign_name ?? "—",
                id: a.campaign_id ?? null,
                n: 0,
              };
              cur.n += 1;
              byRaise.set(key, cur);
            }
            const waves = [...byRaise.values()].sort((a, b) => b.n - a.n);
            if (real.length === 0) {
              return <p className="sub">Nobody named is waiting on a letter.</p>;
            }
            return (
              <>
                {drafted.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Letter written</th>
                        <th>Raise</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafted.slice(0, 8).map((a) => (
                        <tr key={a.campaign_partner_id}>
                          <td>
                            {a.partner_id ? (
                              <Link href={`/person/${a.partner_id}`}>{a.partner_name}</Link>
                            ) : a.partner_name}
                            <div className="faint">{a.firm_name}</div>
                          </td>
                          <td>{a.campaign_name}</td>
                          <td>
                            <Link href={`/tracker/${a.campaign_partner_id}/draft`}>
                              Open the letter
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {waves.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Approved, no letter yet</th>
                        <th>People</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {waves.map((w) => (
                        <tr key={w.id ?? w.name}>
                          <td>{w.name}</td>
                          <td>{w.n}</td>
                          <td>
                            <Link
                              href={
                                w.id
                                  ? `/company?c=${w.id}`
                                  : `/company?c=${encodeURIComponent(w.name)}`
                              }
                            >
                              Work this wave
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            );
          })()}
        </div>

      <div className="card">
        <h2>Quiet more than 7 days</h2>
        <p className="sub">
          Grouped by the company you are raising for, so a 200-name wave
          reads as a wave. “Open this raise” is the Company tab for that
          company.
        </p>
        {data.stuckByRaise.length === 0 ? (
          <p className="sub">No dated quiet rows.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Raise</th><th>Quiet</th><th>Oldest</th><th></th></tr>
            </thead>
            <tbody>
              {data.stuckByRaise.map((g) => {
                const href = g.campaign_id
                  ? `/company?c=${g.campaign_id}`
                  : `/company?c=${encodeURIComponent(g.campaign_name ?? "")}`;
                return (
                  <tr key={g.campaign_id ?? g.campaign_name ?? "raise"}>
                    <td><Link href={href}>{g.campaign_name}</Link></td>
                    <td>{g.count}</td>
                    <td>
                      {g.oldestDays == null ? "no date" : `${g.oldestDays} days`}
                      {g.oldestName ? ` · ${g.oldestName}` : ""}
                    </td>
                    <td>
                      <Hint label="Opens the Company tab for this raise — the tracker of everyone on that company.">
                        <Link href={href}>Open this raise</Link>
                      </Hint>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </div>
  );
}
