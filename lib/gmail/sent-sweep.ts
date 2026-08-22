import { writeAudit } from "@/lib/capital/audit";
import { advanceToApproached } from "@/lib/capital/outreach-gate";
import { bumpSyncState } from "@/lib/capital/rpc";
import { capitalActor, createEngageClient } from "@/lib/supabase/capital";
import { getGoogleAccessToken, getGoogleAccessTokenAdmin } from "@/lib/gmail/user-token";

async function token(): Promise<string | null> {
  try {
    return (await getGoogleAccessToken()).accessToken;
  } catch {
    const t = await getGoogleAccessTokenAdmin();
    return t?.accessToken ?? null;
  }
}

async function gmailGet(access: string, path: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (res.status === 404) return { ok: false, status: 404, json: null };
  if (!res.ok) return { ok: false, status: res.status, json: null };
  return { ok: true, status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function sentMessageId(thread: Record<string, unknown> | null): string | null {
  const messages = (thread?.messages as { id?: string; labelIds?: string[] }[] | undefined) ?? [];
  const sent = [...messages].reverse().find((m) => (m.labelIds ?? []).includes("SENT"));
  return sent?.id ?? null;
}

export async function runSentMailSweep(): Promise<{
  scanned: number;
  sent: number;
  approached: number;
  blocked: string[];
}> {
  const access = await token();
  if (!access) {
    await bumpSyncState("gmail", "sent-sweep: Gmail is not connected");
    return { scanned: 0, sent: 0, approached: 0, blocked: ["Gmail is not connected"] };
  }
  const engage = createEngageClient();
  const { data: drafts, error } = await engage
    .from("email_drafts")
    .select("id, participation_id, gmail_draft_id, gmail_thread_id, kind, subject")
    .is("sent_at", null)
    .is("superseded_at", null)
    .not("gmail_draft_id", "is", null)
    .limit(80);
  if (error) {
    await bumpSyncState("gmail", error.message);
    return { scanned: 0, sent: 0, approached: 0, blocked: [error.message] };
  }
  let sent = 0;
  let approached = 0;
  const blocked: string[] = [];
  for (const d of drafts ?? []) {
    const draftId = d.gmail_draft_id as string;
    const still = await gmailGet(access, `/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`);
    if (still.status === 200) continue;
    if (still.status !== 404) {
      blocked.push(`draft ${draftId}: HTTP ${still.status}`);
      continue;
    }
    let messageId: string | null = null;
    if (d.gmail_thread_id) {
      const th = await gmailGet(access, `/gmail/v1/users/me/threads/${encodeURIComponent(String(d.gmail_thread_id))}?format=minimal`);
      messageId = sentMessageId(th.json);
    }
    const now = new Date().toISOString();
    await engage
      .from("email_drafts")
      .update({ sent_message_id: messageId, sent_at: now })
      .eq("id", d.id);
    sent += 1;
    await writeAudit({
      action: "email_draft.sent",
      entity: `email_drafts:${d.id}`,
      after: { sent_message_id: messageId, sent_at: now },
    });

    const { data: part } = await engage
      .from("participations")
      .select("id, stage, person_id, firm_id, mandate_id")
      .eq("id", d.participation_id)
      .maybeSingle();
    if (part?.person_id) {
      const { data: activity } = await engage
        .from("activities")
        .insert({
          occurred_at: now,
          channel: "email_out",
          subject: d.subject,
          snippet: "Sent (detected by sweep)",
          source_id: messageId ? `gmail:${messageId}` : `gmail-draft-sent:${draftId}`,
          match_confidence: 1,
          created_by: capitalActor(),
        })
        .select("id")
        .maybeSingle();
      if (activity?.id) {
        const links: { activity_id: string; entity_type: string; entity_id: string; link_source: string }[] = [
          { activity_id: activity.id, entity_type: "person", entity_id: part.person_id, link_source: "app" },
        ];
        if (part.firm_id) {
          links.push({
            activity_id: activity.id,
            entity_type: "firm",
            entity_id: part.firm_id,
            link_source: "app",
          });
        }
        await engage.from("activity_links").insert(links);
      }
    }
    if (part && (d.kind === "first_touch" || part.stage === "approved")) {
      const adv = await advanceToApproached(part.id);
      if (adv.ok) approached += 1;
      else if (adv.error) blocked.push(adv.error);
    }
  }
  await bumpSyncState("gmail");
  return { scanned: drafts?.length ?? 0, sent, approached, blocked };
}
