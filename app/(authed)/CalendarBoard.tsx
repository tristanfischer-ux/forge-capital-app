"use client";

import { useEffect, useState } from "react";
import {
  programmeLabel,
  type CalendarProgramme,
  type LiveCalendarEvent,
} from "@/lib/capital/calendar-colour";
import { MANDATE_CODES, MANDATE_LABEL, type MandateCode } from "@/lib/capital/mandates";

function timeLocal(iso: string, allDay: boolean): string {
  if (allDay) return "All day";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function heading(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

function isToday(dayKey: string): boolean {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return dayKey === `${y}-${m}-${d}`;
}

const LEGEND: { code: CalendarProgramme; label: string }[] = [
  ...MANDATE_CODES.map((code) => ({
    code,
    label: code === "YU" ? "Yuri · customers" : MANDATE_LABEL[code as MandateCode],
  })),
  { code: "personal", label: "Other" },
];

export function CalendarBoard({
  initial,
  initialDays,
  googleOk,
  needsCalendarScope,
  error,
}: {
  initial: LiveCalendarEvent[];
  initialDays: string[];
  googleOk: boolean;
  needsCalendarScope: boolean;
  error?: string;
}) {
  const [events, setEvents] = useState(initial);
  const [days, setDays] = useState(initialDays);
  const [stamp, setStamp] = useState<string | null>(null);
  const [err, setErr] = useState(error ?? null);
  const [scope, setScope] = useState(needsCalendarScope);
  const [ok, setOk] = useState(googleOk);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/desk-calendar", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          events?: LiveCalendarEvent[];
          days?: string[];
          googleOk?: boolean;
          needsCalendarScope?: boolean;
          error?: string;
          generated_at?: string;
        };
        if (cancelled) return;
        if (Array.isArray(body.events)) setEvents(body.events);
        if (Array.isArray(body.days) && body.days.length) setDays(body.days);
        if (typeof body.googleOk === "boolean") setOk(body.googleOk);
        if (typeof body.needsCalendarScope === "boolean") setScope(body.needsCalendarScope);
        setErr(body.error ?? null);
        setStamp(body.generated_at ?? new Date().toISOString());
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

  return (
    <>
      <p className="faint" style={{ marginBottom: 12 }}>
        Next seven days from Google Calendar
        {stamp
          ? ` · last pull ${new Date(stamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
        . Colours are the programme the title and guests look like.
      </p>
      {scope ? (
        <div className="warn-banner">
          Google Calendar read access is missing.{" "}
          <a href="/api/auth/gmail">Reconnect Google</a> so the week can load.
        </div>
      ) : null}
      {!ok ? (
        <div className="warn-banner">
          Google is not connected. <a href="/api/auth/gmail">Connect Google</a>.
        </div>
      ) : null}
      {err ? <div className="warn-banner">{err}</div> : null}

      <div className="cal-legend">
        {LEGEND.map((item) => (
          <span key={item.code} className={`cal-leg evt-${item.code.toLowerCase()}`}>
            {item.label}
          </span>
        ))}
      </div>

      <div className="cal cal-days cal-week-ahead">
        {days.map((key) => {
          const dayEvents = events
            .filter((m) => m.day_key === key)
            .sort((a, b) => a.event_at.localeCompare(b.event_at));
          return (
            <div key={key} className={`cal-day${isToday(key) ? " today" : ""}`}>
              <div className="hd">{heading(key)}</div>
              {dayEvents.length === 0 ? (
                <div className="faint" style={{ padding: 8 }}>
                  Nothing on this day
                </div>
              ) : (
                dayEvents.map((m) => {
                  const href = m.htmlLink ?? `/meeting/${encodeURIComponent(`gcal:${m.id}`)}`;
                  const klass = [
                    "evt",
                    `evt-${(m.canceled ? "canceled" : m.colour).toLowerCase()}`,
                    m.canceled ? "canceled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const tag =
                    m.programmes.length > 0
                      ? m.programmes.map((c) => programmeLabel(c)).join(" · ")
                      : "Other";
                  return (
                    <a
                      key={m.id}
                      href={href}
                      target={m.htmlLink ? "_blank" : undefined}
                      rel={m.htmlLink ? "noreferrer" : undefined}
                      className={klass}
                    >
                      <div className="faint">{timeLocal(m.event_at, m.allDay)}</div>
                      <div>{m.title}</div>
                      <div className="faint">{m.canceled ? "Cancelled" : tag}</div>
                    </a>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
