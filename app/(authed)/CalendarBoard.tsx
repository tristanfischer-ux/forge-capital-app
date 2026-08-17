"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DeskMeeting } from "@/lib/queries/desk-today";
import { Hint } from "./Hint";

function ymdLocal(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function meetingHref(id: string): string {
  return `/meeting/${encodeURIComponent(id)}`;
}

export function CalendarBoard({ initial }: { initial: DeskMeeting[] }) {
  const [meetings, setMeetings] = useState(initial);
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/desk-week", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { meetings?: DeskMeeting[]; generated_at?: string };
        if (!cancelled && Array.isArray(body.meetings) && body.meetings.length) {
          setMeetings(body.meetings);
          setStamp(body.generated_at ?? new Date().toISOString());
        }
      } catch {
        /* keep last good week */
      }
    }
    pull();
    const t = setInterval(pull, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const start = new Date();
  const monday = new Date(start);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  return (
    <>
      <p className="faint" style={{ marginBottom: 12 }}>
        Refreshes every five minutes
        {stamp
          ? ` · last pull ${new Date(stamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
        .
      </p>
      <div className="cal cal-days">
        {days.map((d) => {
          const key = ymdLocal(d);
          const events = meetings.filter((m) => ymdLocal(m.event_at) === key);
          return (
            <div key={key} className="cal-day">
              <div className="hd">
                {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
              </div>
              {events.length === 0 ? (
                <div className="faint" style={{ padding: 8 }}>No meetings</div>
              ) : (
                events.map((m) => (
                  <Link
                    key={m.id}
                    href={meetingHref(m.id)}
                    className={`evt${m.canceled ? " canceled" : m.unmatched ? " unmatched" : ""}`}
                  >
                    <div className="faint">{timeLocal(m.event_at)}</div>
                    <div>{m.partner_name ?? m.title ?? "Meeting"}</div>
                    <div className="faint">
                      {m.canceled
                        ? "Canceled — do not prep as live"
                        : m.campaign_name ?? (m.unmatched ? "not on the tracker yet" : "—")}
                    </div>
                    {m.unmatched ? (
                      <Hint label="We have the calendar event, but this person is not a unique email on the raise tracker. Click the card to see everything we do have.">
                        <span>Open briefing</span>
                      </Hint>
                    ) : (
                      <span>Open briefing</span>
                    )}
                  </Link>
                ))
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
