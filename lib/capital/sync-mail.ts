import {
  capitalActor,
  capitalConfigured,
  createCoreClient,
  createEngageClient,
} from "@/lib/supabase/capital";
import { bumpSyncState } from "@/lib/capital/rpc";

export type BookPerson = {
  id: string;
  firm_id: string | null;
  email: string;
  full_name: string | null;
};

export async function loadBookPeopleByEmail(): Promise<Map<string, BookPerson>> {
  const map = new Map<string, BookPerson>();
  if (!capitalConfigured()) return map;
  const core = createCoreClient();
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await core
      .from("people")
      .select("id, firm_id, email, full_name")
      .not("email", "is", null)
      .range(from, from + 999);
    if (error || !data) break;
    for (const p of data) {
      const email = String(p.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      map.set(email, {
        id: p.id,
        firm_id: p.firm_id,
        email,
        full_name: p.full_name,
      });
    }
    if (data.length < 1000) break;
  }
  return map;
}

function extractEmails(blob: string): string[] {
  return (blob.toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) ?? []) as string[];
}

export async function recordBookActivity(opts: {
  sourceId: string;
  occurredAt: string;
  channel: string;
  subject: string | null;
  snippet?: string | null;
  fromToBlob: string;
  peopleByEmail: Map<string, BookPerson>;
}): Promise<"inserted" | "exists" | "unmatched" | "skipped"> {
  if (!capitalConfigured()) return "skipped";
  const engage = createEngageClient();
  const { data: existing } = await engage
    .from("activities")
    .select("id")
    .eq("source_id", opts.sourceId)
    .maybeSingle();
  if (existing?.id) return "exists";

  const hits: BookPerson[] = [];
  const seen = new Set<string>();
  for (const email of extractEmails(opts.fromToBlob)) {
    const person = opts.peopleByEmail.get(email);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      hits.push(person);
    }
  }
  if (hits.length === 0) {
    const core = createCoreClient();
    const domains = [
      ...new Set(
        extractEmails(opts.fromToBlob)
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
  return "inserted";
}

export async function markFeed(feed: "gmail" | "calendar" | "export", error?: string) {
  await bumpSyncState(feed, error ?? null);
}
