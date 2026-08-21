import type { DeskMeeting, DeskReply } from "@/lib/queries/desk-today";
import {
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";

export async function getBookMeetingsAndReplies(): Promise<{
  meetings: DeskMeeting[];
  replies: DeskReply[];
}> {
  if (!capitalConfigured()) return { meetings: [], replies: [] };
  const engage = createEngageClient();
  const core = createCoreClient();
  const now = Date.now();
  const weekOut = new Date(now + 7 * 86400000).toISOString();
  const weekAgo = new Date(now - 14 * 86400000).toISOString();

  const { data: acts, error } = await engage
    .from("activities")
    .select("id, occurred_at, channel, subject, snippet, source_id")
    .gte("occurred_at", weekAgo)
    .lte("occurred_at", weekOut)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error || !acts?.length) return { meetings: [], replies: [] };

  const ids = acts.map((a) => a.id);
  const { data: links } = await engage
    .from("activity_links")
    .select("activity_id, entity_type, entity_id")
    .in("activity_id", ids);
  const personIds = [
    ...new Set(
      (links ?? [])
        .filter((l) => l.entity_type === "person")
        .map((l) => l.entity_id),
    ),
  ];
  const firmIds = [
    ...new Set(
      (links ?? [])
        .filter((l) => l.entity_type === "firm")
        .map((l) => l.entity_id),
    ),
  ];
  const [{ data: people }, { data: firms }] = await Promise.all([
    personIds.length
      ? core.from("people").select("id, full_name, email, firm_id").in("id", personIds)
      : Promise.resolve({ data: [] }),
    firmIds.length
      ? core.from("firms").select("id, canonical_name").in("id", firmIds)
      : Promise.resolve({ data: [] }),
  ]);
  const personById = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  const firmById = Object.fromEntries((firms ?? []).map((f) => [f.id, f]));
  const linksByAct = new Map<string, { person?: string; firm?: string }>();
  for (const l of links ?? []) {
    const cur = linksByAct.get(l.activity_id) ?? {};
    if (l.entity_type === "person") cur.person = l.entity_id;
    if (l.entity_type === "firm") cur.firm = l.entity_id;
    linksByAct.set(l.activity_id, cur);
  }

  const meetings: DeskMeeting[] = [];
  const replies: DeskReply[] = [];
  for (const a of acts) {
    const link = linksByAct.get(a.id) ?? {};
    const person = link.person ? personById[link.person] : null;
    const firmId = link.firm ?? person?.firm_id ?? null;
    const firm = firmId ? firmById[firmId] : null;
    if (a.channel === "calendar") {
      meetings.push({
        id: a.source_id || a.id,
        event_at: a.occurred_at,
        title: a.subject,
        summary: a.snippet ?? a.subject,
        partner_id: person?.id ?? null,
        partner_name: person?.full_name ?? null,
        firm_name: firm?.canonical_name ?? null,
        campaign_name: null,
        status_code: null,
        unmatched: !person,
        channel: "calendar",
        attendee_emails: person?.email ? [person.email] : [],
      });
    } else if (a.channel === "email_in" || a.channel === "email_out") {
      replies.push({
        id: a.id,
        event_at: a.occurred_at,
        summary: a.subject,
        preview: a.snippet,
        from: person?.full_name ?? person?.email ?? null,
        partner_id: person?.id ?? null,
        partner_name: person?.full_name ?? null,
        firm_name: firm?.canonical_name ?? null,
        campaign_name: null,
        status_code: null,
        gmail_thread_id: a.source_id,
      });
    }
  }
  meetings.sort((a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime());
  return { meetings, replies };
}
