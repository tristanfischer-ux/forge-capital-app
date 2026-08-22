import { searchGmailForEmails } from "@/lib/gmail/search-mail";
import { createEngageClient } from "@/lib/supabase/capital";
import { inChunks } from "@/lib/supabase/in-chunks";
import {
  sortCorrespondenceNewestFirst,
  type MeetingCorrespondence,
} from "@/lib/queries/meeting-brief";

export type LiveCorrespondence = {
  mail: MeetingCorrespondence[];
  searched: string[];
  gmailOk: boolean;
  error?: string;
};

function channelOf(from: string, channel: string): { from: string; to: string } {
  if (channel === "email_out" || channel === "draft") {
    return { from: "Tristan Fischer", to: from || "" };
  }
  return { from: from || "Unknown", to: "Tristan Fischer" };
}

export async function loadLiveCorrespondence(opts: {
  emails: string[];
  personId?: string | null;
}): Promise<LiveCorrespondence> {
  const searched = [...new Set(opts.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const [gmail, book] = await Promise.all([
    searched.length
      ? searchGmailForEmails(searched, 20)
      : Promise.resolve({ mail: [] as MeetingCorrespondence[], gmailOk: false as boolean, error: undefined as string | undefined }),
    opts.personId ? activitiesForPerson(opts.personId) : Promise.resolve([] as MeetingCorrespondence[]),
  ]);

  const byKey = new Map<string, MeetingCorrespondence>();
  for (const row of [...gmail.mail, ...book]) {
    const key = row.threadId || row.id || `${row.date}|${row.subject}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return {
    mail: sortCorrespondenceNewestFirst([...byKey.values()]),
    searched,
    gmailOk: gmail.gmailOk,
    error: gmail.error,
  };
}

async function activitiesForPerson(personId: string): Promise<MeetingCorrespondence[]> {
  const engage = createEngageClient();
  const links = await inChunks([personId], async (chunk) => {
    const { data, error } = await engage
      .from("activity_links")
      .select("activity_id, entity_id")
      .eq("entity_type", "person")
      .in("entity_id", chunk);
    if (error) return [];
    return data ?? [];
  });
  const actIds = [...new Set(links.map((l) => l.activity_id))];
  if (!actIds.length) return [];
  const acts = await inChunks(actIds, async (chunk) => {
    const { data, error } = await engage
      .from("activities")
      .select("id, occurred_at, channel, subject, snippet, source_id")
      .in("id", chunk)
      .in("channel", ["email_out", "email_in", "draft"])
      .order("occurred_at", { ascending: false })
      .limit(40);
    if (error) return [];
    return data ?? [];
  });
  return acts.slice(0, 40).map((a) => {
    const dir = channelOf("", a.channel ?? "");
    const gmailId =
      typeof a.source_id === "string" && a.source_id.startsWith("gmail:")
        ? a.source_id.slice("gmail:".length)
        : a.id;
    return {
      id: gmailId,
      from: dir.from,
      to: dir.to,
      subject: a.subject ?? (a.channel === "draft" ? "Draft" : ""),
      date: a.occurred_at ?? "",
      snippet: a.snippet ?? "",
    };
  });
}
