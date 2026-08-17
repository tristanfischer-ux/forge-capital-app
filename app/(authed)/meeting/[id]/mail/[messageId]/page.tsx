import Link from "next/link";
import { notFound } from "next/navigation";
import { getGmailMessage } from "@/lib/gmail/read-thread";
import { readDeskWeekCache } from "@/lib/queries/desk-calendar";
import {
  decodeMailText,
  gmailOpenHref,
  loadMeetingBriefs,
} from "@/lib/queries/meeting-brief";

export const dynamic = "force-dynamic";

export default async function MeetingMailPage({
  params,
}: {
  params: Promise<{ id: string; messageId: string }>;
}) {
  const { id, messageId } = await params;
  const meetingId = decodeURIComponent(id);
  const mailId = decodeURIComponent(messageId);
  const cache = await readDeskWeekCache();
  const meeting =
    cache.meetings.find(
      (m) => m.id === meetingId || m.id === `gcal:${meetingId}` || meetingId.endsWith(m.id),
    ) ?? null;
  if (!meeting) notFound();

  const briefs = loadMeetingBriefs();
  const filed = briefs[meeting.id] ?? briefs[meetingId] ?? null;
  const stored = (filed?.correspondence ?? []).find((m) => m.id === mailId) ?? null;

  let live: Awaited<ReturnType<typeof getGmailMessage>> | null = null;
  let liveError: string | null = null;
  try {
    live = await getGmailMessage(mailId);
  } catch (err) {
    liveError = err instanceof Error ? err.message : "Could not load Gmail.";
    if (liveError.includes("NOT_CONNECTED") || liveError.includes("Not signed in")) {
      liveError = "Gmail is not connected in this session — opening the letter in Gmail still works.";
    }
  }

  const subject = live?.subject ?? stored?.subject ?? "Letter";
  const from = live?.from ?? stored?.from ?? "—";
  const to = live?.to ?? stored?.to ?? "—";
  const when = stored?.date
    ? new Date(stored.date).toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : live?.internalDate
      ? new Date(live.internalDate).toLocaleString("en-GB")
      : "—";
  const body = (live?.body && live.body.trim()) || decodeMailText(stored?.snippet ?? "");
  const gmailHref = stored
    ? gmailOpenHref(stored)
    : live
      ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(live.threadId)}`
      : "https://mail.google.com";

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>{subject}</h1>
          <p>
            {from} → {to} · {when}
          </p>
        </div>
        <div className="btn-row" style={{ margin: 0 }}>
          <Link href={`/meeting/${encodeURIComponent(meeting.id)}`} className="btn">
            Back to the briefing
          </Link>
          <a className="btn btn-primary" href={gmailHref} target="_blank" rel="noreferrer">
            Open in Gmail
          </a>
        </div>
      </div>
      <div className="card">
        <h2>The letter</h2>
        <p className="sub">
          {live?.body
            ? "Full text from Gmail."
            : liveError
              ? liveError
              : "Opening lines on file. Open in Gmail for the rest."}
        </p>
        <pre className="mail-body">{body || "No body on file."}</pre>
      </div>
    </div>
  );
}
