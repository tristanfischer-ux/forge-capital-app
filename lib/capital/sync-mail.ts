import { bumpSyncState } from "@/lib/capital/rpc";
import {
  extractDisplayNames,
  isNoiseAddress,
  normalizeEmail,
} from "@/lib/capital/noise";
import {
  capitalActor,
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";

export type BookPerson = {
  id: string;
  firm_id: string | null;
  email: string;
  full_name: string | null;
};

export type BookIndex = {
  byEmail: Map<string, BookPerson>;
  byName: Map<string, BookPerson>;
};

export async function loadBookIndex(): Promise<BookIndex> {
  const byEmail = new Map<string, BookPerson>();
  const byName = new Map<string, BookPerson>();
  if (!capitalConfigured()) return { byEmail, byName };
  const core = createCoreClient();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await core
      .from("people")
      .select("id, firm_id, email, full_name")
      .range(from, from + 999);
    if (error || !data) break;
    for (const p of data) {
      const person: BookPerson = {
        id: p.id,
        firm_id: p.firm_id,
        email: String(p.email ?? "").trim().toLowerCase(),
        full_name: p.full_name,
      };
      if (person.email) {
        byEmail.set(person.email, person);
        byEmail.set(normalizeEmail(person.email), person);
      }
      const name = (p.full_name ?? "").trim().toLowerCase();
      if (name && name.length > 3 && !name.includes("@") && !/^not specifically/i.test(name)) {
        if (!byName.has(name)) byName.set(name, person);
      }
    }
    if (data.length < 1000) break;
  }
  return { byEmail, byName };
}

export async function loadBookPeopleByEmail(): Promise<Map<string, BookPerson>> {
  const idx = await loadBookIndex();
  return idx.byEmail;
}

function extractEmails(blob: string): string[] {
  return (blob.toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) ?? []) as string[];
}

function looksCancelled(subject: string | null, snippet?: string | null): boolean {
  return /cancel+ed|cancelled/i.test(`${subject ?? ""} ${snippet ?? ""}`);
}

export async function recordBookActivity(opts: {
  sourceId: string;
  occurredAt: string;
  channel: string;
  subject: string | null;
  snippet?: string | null;
  fromToBlob: string;
  peopleByEmail: Map<string, BookPerson>;
  peopleByName?: Map<string, BookPerson>;
}): Promise<"inserted" | "exists" | "unmatched" | "skipped" | "noise" | "cancelled"> {
  if (!capitalConfigured()) return "skipped";
  const engage = createEngageClient();
  const { data: existing } = await engage
    .from("activities")
    .select("id, channel")
    .eq("source_id", opts.sourceId)
    .maybeSingle();

  const emails = extractEmails(opts.fromToBlob);
  const allNoise = emails.length > 0 && emails.every(isNoiseAddress);
  if (allNoise && !existing) return "noise";

  const hits: BookPerson[] = [];
  const seen = new Set<string>();
  for (const email of emails) {
    if (isNoiseAddress(email)) continue;
    const person =
      opts.peopleByEmail.get(email) || opts.peopleByEmail.get(normalizeEmail(email));
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      hits.push(person);
    }
  }
  if (hits.length === 0 && opts.peopleByName) {
    for (const name of extractDisplayNames(opts.fromToBlob)) {
      const person = opts.peopleByName.get(name.toLowerCase());
      if (person && !seen.has(person.id)) {
        seen.add(person.id);
        hits.push(person);
      }
    }
  }

  if (looksCancelled(opts.subject, opts.snippet) && hits.length) {
    for (const p of hits) {
      await cancelCalendarForPerson(p.id, opts.occurredAt);
    }
  }

  if (opts.channel === "calendar_cancelled" && existing?.id) {
    await engage
      .from("activities")
      .update({
        channel: "calendar_cancelled",
        subject: `[CANCELLED] ${(opts.subject ?? "").replace(/^\[CANCELLED\]\s*/i, "")}`.slice(0, 500),
        snippet: opts.snippet ?? null,
      })
      .eq("id", existing.id);
    return "cancelled";
  }

  if (existing?.id) return "exists";

  if (hits.length === 0) {
    const core = createCoreClient();
    const domains = [
      ...new Set(
        emails
          .filter((e) => !isNoiseAddress(e))
          .map((e) => e.split("@")[1])
          .filter(Boolean),
      ),
    ];
    for (const d of domains) {
      if (["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com"].includes(d))
        continue;
      const { data: firm } = await core
        .from("firms")
        .select("id")
        .eq("website_domain", d)
        .maybeSingle();
      if (firm?.id) {
        const { data: activity, error } = await engage
          .from("activities")
          .insert({
            occurred_at: opts.occurredAt,
            channel: opts.channel,
            subject: (opts.subject ?? "").slice(0, 500),
            snippet: opts.snippet ?? null,
            source_id: opts.sourceId,
            match_confidence: 0.6,
            created_by: capitalActor(),
          })
          .select("id")
          .maybeSingle();
        if (error) {
          if (/unique|duplicate/i.test(error.message)) return "exists";
          throw new Error(error.message);
        }
        if (!activity?.id) return "skipped";
        await engage.from("activity_links").insert({
          activity_id: activity.id,
          entity_type: "firm",
          entity_id: firm.id,
          link_source: "auto",
        });
        return "inserted";
      }
    }
    return "unmatched";
  }

  const { data: activity, error } = await engage
    .from("activities")
    .insert({
      occurred_at: opts.occurredAt,
      channel: opts.channel,
      subject: (opts.subject ?? "").slice(0, 500),
      snippet: opts.snippet ?? null,
      source_id: opts.sourceId,
      match_confidence: 1,
      created_by: capitalActor(),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (/unique|duplicate/i.test(error.message)) return "exists";
    throw new Error(error.message);
  }
  if (!activity?.id) return "skipped";

  const links = [];
  const firms = new Set<string>();
  for (const p of hits) {
    links.push({
      activity_id: activity.id,
      entity_type: "person",
      entity_id: p.id,
      link_source: "auto",
    });
    if (p.firm_id && !firms.has(p.firm_id)) {
      firms.add(p.firm_id);
      links.push({
        activity_id: activity.id,
        entity_type: "firm",
        entity_id: p.firm_id,
        link_source: "auto",
      });
    }
  }
  if (links.length) {
    await engage.from("activity_links").insert(links);
  }
  if (opts.channel === "email_out" || opts.channel === "email_in") {
    for (const p of hits) {
      await engage
        .from("participations")
        .update({ latest_touch: opts.occurredAt })
        .eq("person_id", p.id);
    }
  }
  return "inserted";
}

export async function cancelCalendarForPerson(personId: string, aroundIso: string): Promise<number> {
  if (!capitalConfigured()) return 0;
  const engage = createEngageClient();
  const centre = new Date(aroundIso).getTime();
  const from = new Date(centre - 14 * 86400000).toISOString();
  const to = new Date(centre + 14 * 86400000).toISOString();
  const { data: links } = await engage
    .from("activity_links")
    .select("activity_id")
    .eq("entity_type", "person")
    .eq("entity_id", personId);
  const ids = (links ?? []).map((l) => l.activity_id);
  if (!ids.length) return 0;
  const { data: acts } = await engage
    .from("activities")
    .select("id, subject, channel")
    .in("id", ids)
    .eq("channel", "calendar")
    .gte("occurred_at", from)
    .lte("occurred_at", to);
  let n = 0;
  for (const a of acts ?? []) {
    const subject = a.subject?.startsWith("[CANCELLED]")
      ? a.subject
      : `[CANCELLED] ${a.subject ?? ""}`;
    const { error } = await engage
      .from("activities")
      .update({ channel: "calendar_cancelled", subject: subject.slice(0, 500) })
      .eq("id", a.id);
    if (!error) n++;
  }
  return n;
}

export async function markFeed(feed: "gmail" | "calendar" | "export" | "neverbounce", error?: string) {
  await bumpSyncState(feed, error ?? null);
}
