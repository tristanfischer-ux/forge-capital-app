"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { evaluateDraftGate } from "@/lib/capital/draft-gate";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { verifyPersonEmail } from "@/lib/capital/neverbounce";
import { composeOutreachDraft } from "@/lib/capital/voice";
import { recordEmailDraft } from "@/lib/capital/email-drafts";
import { createGmailDraft } from "@/lib/gmail/create-draft";

export async function verifyBookPerson(personId: string) {
  await requireTristan();
  const result = await verifyPersonEmail(personId);
  revalidatePath("/send", "layout");
  revalidatePath(`/person/${personId}`);
  return result;
}

export async function createBookDraft(input: {
  participationId: string;
  mandateCode: MandateCode;
  opener?: string;
}): Promise<{ ok: true; gmailDraftId: string; gmailUrl: string } | { ok: false; error: string }> {
  await requireTristan();
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: part, error } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, mandate_id, mandates:mandate_id ( code, company_name, ask_summary, narrative_notes, status )")
    .eq("id", input.participationId)
    .maybeSingle();
  if (error || !part) return { ok: false, error: "Participation not found." };
  const mandate = Array.isArray(part.mandates) ? part.mandates[0] : part.mandates;
  const code = (mandate?.code ?? input.mandateCode) as MandateCode;

  const [{ data: person }, { data: firm }] = await Promise.all([
    part.person_id
      ? core.from("people").select("id, full_name, email").eq("id", part.person_id).maybeSingle()
      : Promise.resolve({ data: null }),
    part.firm_id
      ? core.from("firms").select("id, canonical_name, hq_country").eq("id", part.firm_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!person?.email) return { ok: false, error: "No named person with an email." };

  const pre = await evaluateDraftGate({
    personId: part.person_id,
    firmId: part.firm_id,
    mandateCode: code,
    stage: part.stage,
  });
  if (!pre.allowed) return { ok: false, error: pre.why };
  if (pre.warm && !input.opener?.trim()) {
    return { ok: false, error: "There is a prior thread. Write an opener that references it." };
  }

  const composed = composeOutreachDraft({
    personName: person.full_name ?? "",
    firmName: firm?.canonical_name ?? "",
    mandateCode: code,
    askSummary: mandate?.ask_summary,
    narrativeNotes: mandate?.narrative_notes,
    warm: pre.warm,
    lastSubject: pre.lastThread?.subject,
    lastOccurredAt: pre.lastThread?.occurred_at,
    opener: input.opener,
  });

  const gate = await evaluateDraftGate({
    personId: part.person_id,
    firmId: part.firm_id,
    mandateCode: code,
    stage: part.stage,
    body: composed.body,
    subject: composed.subject,
    opener: input.opener ?? composed.body,
  });
  if (!gate.allowed) return { ok: false, error: gate.why };

  try {
    const draft = await createGmailDraft({
      to: person.email,
      subject: composed.subject,
      body: composed.body,
      cc: mandateDraftCc(code),
    });
    const recorded = await recordEmailDraft({
      participationId: part.id,
      gmailDraftId: draft.id,
      gmailThreadId: draft.message?.threadId ?? draft.threadId,
      kind: "first_touch",
      subject: composed.subject,
      body: composed.body,
    });
    revalidatePath(`/send/${code}`);
    return { ok: true, gmailDraftId: recorded.gmailDraftId, gmailUrl: recorded.gmailUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") {
      return { ok: false, error: "Gmail is not connected. Reconnect at /api/auth/gmail." };
    }
    return { ok: false, error: message };
  }
}
