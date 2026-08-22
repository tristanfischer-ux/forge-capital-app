import { listWeekAheadCalendar } from "@/lib/capital/live-calendar";
import { counterpartFromTitle, firmHintFromTitle } from "@/lib/desk/calendar-name";
import { readDeskWeekCache } from "@/lib/queries/desk-calendar";
import { getDeskToday, type DeskMeeting } from "@/lib/queries/desk-today";

function variants(raw: string): string[] {
  const u = decodeURIComponent(raw).trim();
  const bare = u.replace(/^(gcal:|cal:|gmail:)/i, "");
  return [...new Set([u, bare, `gcal:${bare}`, `cal:${bare}`])];
}

function matches(meetingId: string, raw: string): boolean {
  const want = variants(raw);
  if (want.includes(meetingId)) return true;
  const bare = meetingId.replace(/^(gcal:|cal:|gmail:)/i, "");
  return want.includes(bare);
}

function fromLiveEvent(fromCal: {
  id: string;
  event_at: string;
  end_at: string | null;
  title: string;
  notes: string | null;
  programmes: string[];
  canceled: boolean;
  attendee_emails: string[];
  htmlLink: string | null;
}): DeskMeeting {
  const counterpart = counterpartFromTitle(fromCal.title);
  return {
    id: `gcal:${fromCal.id}`,
    event_at: fromCal.event_at,
    end_at: fromCal.end_at,
    title: fromCal.title,
    summary: fromCal.title,
    notes: fromCal.notes,
    partner_id: null,
    partner_name: counterpart,
    firm_name: firmHintFromTitle(fromCal.title),
    campaign_name:
      fromCal.programmes[0] === "YU"
        ? "Yuri"
        : fromCal.programmes[0]
          ? fromCal.programmes[0]
          : null,
    status_code: null,
    unmatched: true,
    canceled: fromCal.canceled,
    channel: "calendar",
    attendee_emails: fromCal.attendee_emails,
    htmlLink: fromCal.htmlLink,
  };
}

function overlayLive(found: DeskMeeting, live: ReturnType<typeof fromLiveEvent>): DeskMeeting {
  return {
    ...found,
    attendee_emails:
      found.attendee_emails && found.attendee_emails.length > 0
        ? found.attendee_emails
        : live.attendee_emails,
    htmlLink: found.htmlLink ?? live.htmlLink,
    notes: found.notes ?? live.notes,
    partner_name: found.partner_name ?? live.partner_name,
    firm_name: found.firm_name ?? live.firm_name,
    end_at: found.end_at ?? live.end_at,
    title: found.title ?? live.title,
  };
}

export async function findDeskMeeting(raw: string): Promise<DeskMeeting | null> {
  if (!raw.trim()) return null;

  const [today, cache, week] = await Promise.all([
    getDeskToday(),
    readDeskWeekCache(),
    listWeekAheadCalendar(),
  ]);

  const fromToday = today.meetings.find((m) => matches(m.id, raw));
  const fromCache = cache.meetings.find((m) => matches(m.id, raw));
  const fromCal = week.events.find((e) => matches(e.id, raw));
  const live = fromCal ? fromLiveEvent(fromCal) : null;

  const found = fromToday ?? fromCache ?? live;
  if (!found) return null;
  return live ? overlayLive(found, live) : found;
}
