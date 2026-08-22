import {
  programmesForBlob,
  type CalendarProgramme,
  type LiveCalendarEvent,
} from "@/lib/capital/calendar-colour";
import { getGoogleAccessToken, getGoogleAccessTokenAdmin } from "@/lib/gmail/user-token";

export type { CalendarProgramme, LiveCalendarEvent };

const LONDON = "Europe/London";

function ymdInLondon(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysKey(ymd: string, add: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + add));
  return dt.toISOString().slice(0, 10);
}

function dayKeyFromIso(iso: string, allDay: boolean): string {
  if (allDay && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  return ymdInLondon(new Date(iso));
}

function weekWindow(): { timeMin: string; timeMax: string; days: string[] } {
  const today = ymdInLondon(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i));
  return {
    timeMin: `${today}T00:00:00.000Z`,
    timeMax: `${addDaysKey(today, 7)}T00:00:00.000Z`,
    days,
  };
}

type GCalEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
};

async function access(): Promise<{ token: string; scope: string } | null> {
  try {
    const t = await getGoogleAccessToken();
    return { token: t.accessToken, scope: t.scope };
  } catch {
    const t = await getGoogleAccessTokenAdmin();
    if (!t) return null;
    return { token: t.accessToken, scope: t.scope };
  }
}

export async function listWeekAheadCalendar(): Promise<{
  events: LiveCalendarEvent[];
  days: string[];
  googleOk: boolean;
  needsCalendarScope: boolean;
  error?: string;
}> {
  const window = weekWindow();
  const tok = await access();
  if (!tok) {
    return { events: [], days: window.days, googleOk: false, needsCalendarScope: true };
  }
  if (!tok.scope.includes("calendar.readonly") && !tok.scope.includes("calendar")) {
    return { events: [], days: window.days, googleOk: true, needsCalendarScope: true };
  }

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", window.timeMin);
  url.searchParams.set("timeMax", window.timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");
  url.searchParams.set("showDeleted", "false");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}` } });
  if (!res.ok) {
    return {
      events: [],
      days: window.days,
      googleOk: true,
      needsCalendarScope: false,
      error: `Google Calendar HTTP ${res.status}`,
    };
  }
  const body = (await res.json()) as { items?: GCalEvent[] };
  const events: LiveCalendarEvent[] = [];
  for (const item of body.items ?? []) {
    if (!item.id) continue;
    const allDay = Boolean(item.start?.date && !item.start?.dateTime);
    const startRaw = item.start?.dateTime ?? item.start?.date;
    if (!startRaw) continue;
    const endRaw = item.end?.dateTime ?? item.end?.date ?? null;
    const canceled = item.status === "cancelled" || /^(canceled|cancelled):/i.test(item.summary ?? "");
    const emails = (item.attendees ?? [])
      .map((a) => (a.email ?? "").toLowerCase())
      .filter(Boolean);
    const blob = [
      item.summary ?? "",
      item.description ?? "",
      item.location ?? "",
      emails.join(" "),
    ].join("\n");
    const programmes = programmesForBlob(blob);
    const colour: CalendarProgramme = programmes[0] ?? "personal";
    events.push({
      id: item.id,
      event_at: allDay ? `${startRaw.slice(0, 10)}T09:00:00` : new Date(startRaw).toISOString(),
      end_at: endRaw
        ? allDay
          ? `${endRaw.slice(0, 10)}T09:00:00`
          : new Date(endRaw).toISOString()
        : null,
      day_key: allDay ? startRaw.slice(0, 10) : dayKeyFromIso(startRaw, false),
      title: (item.summary ?? "(no title)").trim() || "(no title)",
      notes: item.description ?? null,
      htmlLink: item.htmlLink ?? null,
      location: item.location ?? null,
      allDay,
      canceled,
      programmes,
      colour: canceled ? "personal" : colour,
      attendee_emails: emails,
    });
  }
  return {
    events,
    days: window.days,
    googleOk: true,
    needsCalendarScope: false,
  };
}


