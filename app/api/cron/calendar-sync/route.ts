import { NextRequest, NextResponse } from "next/server";
import {
  loadBookPeopleByEmail,
  markFeed,
  recordBookActivity,
} from "@/lib/capital/sync-mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken } from "@/lib/gmail/oauth";

export const maxDuration = 300;

async function fetchEvents(accessToken: string, fromIso: string) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", fromIso);
  url.searchParams.set(
    "timeMax",
    new Date(Date.now() + 14 * 86_400_000).toISOString(),
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`calendar.events.list HTTP ${res.status}`);
  }
  const body = (await res.json()) as { items?: Record<string, unknown>[] };
  return body.items ?? [];
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const bookPeople = await loadBookPeopleByEmail();
  const { data: tokens, error: tokenErr } = await supabase
    .from("gmail_tokens")
    .select(
      "user_id, email, access_token, refresh_token, expires_at, scope, calendar_cursor",
    );
  if (tokenErr) {
    return NextResponse.json({ error: tokenErr.message }, { status: 500 });
  }

  const results: Record<string, unknown>[] = [];
  for (const tokenRow of tokens ?? []) {
    const scope = String(tokenRow.scope ?? "");
    if (!scope.includes("calendar.readonly")) {
      results.push({ user: tokenRow.email, skipped: "no calendar scope" });
      continue;
    }
    let accessToken = tokenRow.access_token as string;
    const expires = tokenRow.expires_at
      ? new Date(tokenRow.expires_at as string).getTime()
      : 0;
    if (!accessToken || expires < Date.now() + 60_000) {
      try {
        const refreshed = await refreshAccessToken(
          tokenRow.refresh_token as string,
        );
        accessToken = refreshed.access_token;
        await supabase
          .from("gmail_tokens")
          .update({
            access_token: refreshed.access_token,
            expires_at: new Date(
              Date.now() + refreshed.expires_in * 1000,
            ).toISOString(),
          })
          .eq("user_id", tokenRow.user_id);
      } catch (err) {
        results.push({
          user: tokenRow.email,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    const fromIso = tokenRow.calendar_cursor
      ? new Date(
          new Date(tokenRow.calendar_cursor as string).getTime() - 10 * 60_000,
        ).toISOString()
      : new Date(Date.now() - 48 * 3600_000).toISOString();

    let events: Record<string, unknown>[] = [];
    try {
      events = await fetchEvents(accessToken, fromIso);
    } catch (err) {
      results.push({
        user: tokenRow.email,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    let inserted = 0;
    let unmatched = 0;
    for (const event of events) {
      const start = event.start as { dateTime?: string; date?: string } | undefined;
      const startIso = start?.dateTime ?? start?.date;
      if (!startIso || !event.id) continue;
      const attendees = (event.attendees as { email?: string }[] | undefined) ?? [];
      const blob = attendees.map((a) => a.email ?? "").join(" ");
      const summary = String(event.summary ?? "(untitled)");
      try {
        const book = await recordBookActivity({
          sourceId: `cal:${event.id as string}`,
          occurredAt: new Date(startIso).toISOString(),
          channel: "calendar",
          subject: summary,
          snippet: String(event.description ?? summary).slice(0, 500),
          fromToBlob: blob,
          peopleByEmail: bookPeople,
        });
        if (book === "inserted") inserted++;
        if (book === "unmatched") unmatched++;
      } catch {
        /* keep going */
      }
    }

    await supabase
      .from("gmail_tokens")
      .update({ calendar_cursor: new Date().toISOString() })
      .eq("user_id", tokenRow.user_id);

    results.push({
      user: tokenRow.email,
      events: events.length,
      inserted,
      unmatched,
    });
  }

  await markFeed("calendar");
  return NextResponse.json({
    message: "calendar-sync to shared book",
    book_people: bookPeople.size,
    results,
  });
}
