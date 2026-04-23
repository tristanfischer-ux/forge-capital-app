# Design — scheduled / time-windowed batch sends

**Driver**: Tristan, 2026-04-23.
> *"we also need to get the ability for email batches in the outbox
> to be sent on a timer so that they don't all hit gmail at the
> same time. This will be super useful for my outreach for Fischer
> Farms customers in the Nordics and Canada. I can have them so
> that they arrive between 6am and 7am local time."*

**Goal.** Dispatch a batch of drafts staggered across a configurable
local-time window (per recipient), not in one synchronous burst.

---

## Schema

New migration `023_scheduled_sends.sql`:

```sql
create table public.scheduled_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_partner_id uuid not null
    references public.campaign_partners(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  scheduled_for_utc timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','dispatching','sent','failed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  sent_at timestamptz,
  error_message text,
  gmail_thread_id text,
  gmail_message_id text
);

create index scheduled_sends_due_idx
  on public.scheduled_sends(scheduled_for_utc)
  where status = 'pending';

create index scheduled_sends_partner_idx
  on public.scheduled_sends(campaign_partner_id);
```

RLS: founder-only (same model as the other owned tables).

---

## Timezone resolution

Each partner has `partners_mirror.hq_location` (free-text,
inconsistent — "London, UK", "Menlo Park, California", "Noordwijk",
"NL").

**Strategy.** Small canonical tz lookup in
`lib/gmail/partner-timezone.ts`:

```ts
const HQ_PATTERNS: Array<[RegExp, string]> = [
  [/helsinki|finland|finnish/i, "Europe/Helsinki"],
  [/stockholm|sweden|swedish/i, "Europe/Stockholm"],
  [/oslo|norway|norwegian/i, "Europe/Oslo"],
  [/copenhagen|denmark|danish/i, "Europe/Copenhagen"],
  [/amsterdam|noordwijk|netherlands|dutch/i, "Europe/Amsterdam"],
  [/london|uk|united kingdom|britain/i, "Europe/London"],
  [/toronto|ontario/i, "America/Toronto"],
  [/vancouver|british columbia/i, "America/Vancouver"],
  [/montreal|quebec/i, "America/Montreal"],
  // ...
];

export function timezoneForLocation(hq: string | null): string {
  if (!hq) return "UTC";
  for (const [re, tz] of HQ_PATTERNS) if (re.test(hq)) return tz;
  return "UTC";
}
```

For anything the patterns don't match, default to UTC and surface a
UI warning on the scheduling page ("3 rows have no timezone match;
they'll dispatch at 06:30 UTC unless you override").

---

## Slot assignment

Given a window `[06:00, 07:00]` local time, split `N` rows across the
window randomly (not evenly — evenly looks bot-like):

```ts
export function scheduleSlots(
  rows: Array<{ tz: string }>,
  localHourStart: number,
  localHourEnd: number,
  targetDate: Date,
): Date[] {
  return rows.map(({ tz }) => {
    const jitterMin = Math.floor(
      Math.random() * (localHourEnd - localHourStart) * 60,
    );
    const local = new Date(targetDate);
    local.setHours(localHourStart, 0, 0, 0);
    local.setMinutes(jitterMin);
    return convertLocalToUtc(local, tz);
  });
}
```

Use `Intl.DateTimeFormat` + offset math, or a small lib
(`@date-fns/tz`) for DST-correct conversion.

---

## API surface

New action `queueScheduledBatch`:

```ts
export async function queueScheduledBatch(input: {
  campaignId: string;
  maxCount: number;
  windowLocalStartHour: number;  // e.g. 6
  windowLocalEndHour: number;    // e.g. 7
  targetDate: string;            // ISO date — defaults to next weekday
}): Promise<{ ok: true; queuedCount: number } | { ok: false; error: string }>
```

1. Pick N pending rows (same query as sendTestBatch).
2. Resolve timezone per row.
3. Compute scheduled_for_utc per row.
4. Insert a `scheduled_sends` row for each.
5. Return count.

---

## Dispatcher

`scripts/scheduled-sends-dispatcher.mjs` (node ESM):

```js
// Polls pending rows whose scheduled_for_utc <= now(), dispatches
// via Gmail API, updates status. Runs every minute via launchd.
while (true) {
  const { data: due } = await supabase
    .from("scheduled_sends")
    .select("*")
    .lte("scheduled_for_utc", new Date().toISOString())
    .eq("status", "pending")
    .limit(10);

  for (const row of due) {
    await supabase
      .from("scheduled_sends")
      .update({ status: "dispatching" })
      .eq("id", row.id);
    try {
      const sent = await sendGmailMessage({
        to: row.to_email, subject: row.subject, body: row.body,
      });
      await supabase
        .from("scheduled_sends")
        .update({
          status: "sent", sent_at: new Date().toISOString(),
          gmail_thread_id: sent.threadId,
          gmail_message_id: sent.id,
        })
        .eq("id", row.id);
      // Mirror to contact_events for the timeline.
      await supabase.from("contact_events").insert({
        campaign_partner_id: row.campaign_partner_id,
        event_type: "scheduled_send",
        event_at: new Date().toISOString(),
        direction: "outbound",
        channel: "gmail",
        gmail_thread_id: sent.threadId,
        gmail_message_id: sent.id,
        summary: row.subject,
      });
    } catch (err) {
      await supabase
        .from("scheduled_sends")
        .update({
          status: "failed",
          error_message: String(err),
        })
        .eq("id", row.id);
    }
  }

  await new Promise((r) => setTimeout(r, 60_000));
}
```

Plus a `com.forgecapital.scheduled-sends.plist` launchd job.

---

## UI

Extend `/approval/test-send` (and /approval/send for real sends) with
two new radio options:

```
Dispatch time:
  (•) Send now
  ( ) Schedule: 6am-7am local time
  ( ) Schedule: custom — [start]:00 to [end]:00 local
  Target date: [dropdown of next 5 weekdays]
```

When scheduled, the button label changes to "Queue 20 for 06:00
local on Monday 27 April →". After queueing, the batch doesn't
appear in Gmail immediately — the dispatcher fires them one by one.

A new `/approval/scheduled` surface lists the queue with per-row
status (pending / sent / failed), a "Cancel" action, and a preview of
the next 10 due.

---

## Build order

1. Migration 023 + RLS.
2. timezone helper (small table, testable).
3. queueScheduledBatch action.
4. Dispatcher script + launchd plist.
5. UI scheduling option on /approval/test-send.
6. /approval/scheduled surface to monitor the queue.

Est 4-6 hours end-to-end. Not built this session; this doc captures
the design for the next pickup.
