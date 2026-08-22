import { listWeekAheadCalendar } from "@/lib/capital/live-calendar";
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

export async function findDeskMeeting(raw: string): Promise<DeskMeeting | null> {
  if (!raw.trim()) return null;

  const today = await getDeskToday();
  const fromToday = today.meetings.find((m) => matches(m.id, raw));
  if (fromToday) return fromToday;

  const cache = await readDeskWeekCache();
  const fromCache = cache.meetings.find((m) => matches(m.id, raw));
  if (fromCache) return fromCache;

  const week = await listWeekAheadCalendar();
  const fromCal = week.events.find((e) => matches(e.id, raw));
  if (!fromCal) return null;

  return {
    id: `gcal:${fromCal.id}`,
    event_at: fromCal.event_at,
    end_at: fromCal.end_at,
    title: fromCal.title,
    summary: fromCal.title,
    notes: fromCal.notes,
    partner_id: null,
    partner_name: null,
    firm_name: null,
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
