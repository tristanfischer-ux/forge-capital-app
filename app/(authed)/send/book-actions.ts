"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { evaluateDraftGate } from "@/lib/capital/draft-gate";
import { capitalActor, createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { verifyPersonEmail } from "@/lib/capital/neverbounce";
import { composeOutreachDraft } from "@/lib/capital/voice";
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
    const gmailId = draft.id;
    const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draft.message?.id ?? gmailId)}`;
    const { data: activity } = await engage
      .from("activities")
      .insert({
        occurred_at: new Date().toISOString(),
        channel: "draft",
        subject: composed.subject,
        snippet: `Gmail draft ${gmailId}`,
        source_id: `gmail-draft:${gmailId}`,
        match_confidence: 1,
        created_by: capitalActor(),
      })
      .select("id")
      .maybeSingle();
    if (activity?.id) {
      const links = [];
      if (part.person_id) {
        links.push({
          activity_id: activity.id,
          entity_type: "person",
          entity_id: part.person_id,
          link_source: "app",
        });
      }
      if (part.firm_id) {
        links.push({
          activity_id: activity.id,
          entity_type: "firm",
          entity_id: part.firm_id,
          link_source: "app",
        });
      }
      if (links.length) await engage.from("activity_links").insert(links);
    }
    revalidatePath(`/send/${code}`);
    return { ok: true, gmailDraftId: gmailId, gmailUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") {
      return { ok: false, error: "Gmail is not connected. Reconnect at /api/auth/gmail." };
    }
    return { ok: false, error: message };
  }
}
