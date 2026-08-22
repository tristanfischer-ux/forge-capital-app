import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/capital/audit";
import { capitalActor, createEngageClient } from "@/lib/supabase/capital";

export type DraftKind =
  | "first_touch"
  | "chase_momentum"
  | "chase_closeout"
  | "chase_reopen"
  | "post_meeting"
  | "approval_packet"
  | "thank_you"
  | "follow_up";

export type RecordedDraft = {
  id: string;
  gmailDraftId: string;
  gmailUrl: string;
};

function bodyHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function wordCount(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}

export async function recordEmailDraft(input: {
  participationId: string;
  gmailDraftId: string;
  gmailThreadId?: string | null;
  kind: DraftKind;
  chaseNumber?: number;
  subject: string;
  body: string;
}): Promise<RecordedDraft> {
  const engage = createEngageClient();
  const attach = /\[ATTACH BEFORE SENDING/i.test(input.body);
  const { data, error } = await engage
    .from("email_drafts")
    .insert({
      participation_id: input.participationId,
      gmail_draft_id: input.gmailDraftId,
      gmail_thread_id: input.gmailThreadId ?? null,
      kind: input.kind,
      chase_number: input.chaseNumber ?? 0,
      subject: input.subject,
      body_hash: bodyHash(input.body),
      word_count: wordCount(input.body),
      has_unresolved_attach_marker: attach,
      created_by: capitalActor(),
    })
    .select("id, gmail_draft_id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "email_drafts insert failed");
  }
  await writeAudit({
    action: "email_draft.create",
    entity: `email_drafts:${data.id}`,
    after: {
      participation_id: input.participationId,
      kind: input.kind,
      gmail_draft_id: input.gmailDraftId,
    },
  });
  const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(input.gmailDraftId)}`;
  return { id: data.id, gmailDraftId: data.gmail_draft_id, gmailUrl };
}
