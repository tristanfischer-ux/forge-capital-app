"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { recordEmailDraft } from "@/lib/capital/email-drafts";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import {
  isChaseDraftable,
  mandateDraftCc,
  type MandateCode,
} from "@/lib/capital/mandates";
import { composeChaserDraft } from "@/lib/capital/voice";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { findMandateOutboundThread } from "@/lib/gmail/find-outbound-thread";

export async function createChaserDraft(input: {
  participationId: string;
  mandateCode: MandateCode;
  lastSubject?: string | null;
  lastOccurredAt?: string | null;
}): Promise<{ ok: true; gmailUrl: string } | { ok: false; error: string }> {
  await requireTristan();
  if (!isChaseDraftable(input.mandateCode)) {
    return {
      ok: false,
      error:
        input.mandateCode === "SK"
          ? "SkySails broad outreach is suspended."
          : input.mandateCode === "HO"
            ? "Hooley is paused — listed, not draftable."
            : "This programme is not a raise chase.",
    };
  }
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: part } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage, chase_count, mandate_id")
    .eq("id", input.participationId)
    .maybeSingle();
  if (!part?.person_id) return { ok: false, error: "No named person on that row." };
  if ((part.chase_count ?? 0) >= 2) {
    return { ok: false, error: "Chase sequence already finished (two chasers). Leave it." };
  }
  const [{ data: person }, { data: firm }, { data: mandate }] = await Promise.all([
    core
      .from("people")
      .select(
        "id, full_name, given_name, family_name, salutation_name, email, email_state, dnc, email_name_mismatch",
      )
      .eq("id", part.person_id)
      .maybeSingle(),
    part.firm_id
      ? core.from("firms").select("canonical_name, dnc").eq("id", part.firm_id).maybeSingle()
      : Promise.resolve({ data: null }),
    part.mandate_id
      ? engage.from("mandates").select("ask_summary").eq("id", part.mandate_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!person?.email) return { ok: false, error: "No email on this person." };
  if (person.dnc || firm?.dnc) return { ok: false, error: "Do not contact." };
  if (person.email_name_mismatch) {
    return { ok: false, error: "Name and email do not match — repair the contact first." };
  }
  const salutation = (person.salutation_name ?? person.given_name ?? "").trim();
  if (!salutation) {
    return { ok: false, error: "BLOCKED (Rule 13): no usable name for this person" };
  }
  if (person.email_state !== "verified") {
    return { ok: false, error: `Email is ${person.email_state ?? "unknown"} — verify first.` };
  }

  let thread;
  try {
    thread = await findMandateOutboundThread(person.email, input.mandateCode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") return { ok: false, error: "Gmail is not connected." };
    return { ok: false, error: message };
  }
  if (!thread) {
    return {
      ok: false,
      error: "No original sent mail in Gmail for this programme — will not start a new thread.",
    };
  }
  if (thread.replied) {
    return { ok: false, error: "They already replied on this thread." };
  }
  if (thread.replyKind === "bounce") {
    return { ok: false, error: "Original mail bounced — do not chase this address." };
  }

  const composed = composeChaserDraft({
    personName: salutation,
    firmName: firm?.canonical_name ?? "",
    mandateCode: input.mandateCode,
    lastSubject: thread.subject || input.lastSubject,
    lastOccurredAt: thread.sentAt || input.lastOccurredAt,
    askSummary: mandate?.ask_summary ?? null,
  });
  try {
    const draft = await createGmailDraft({
      to: person.email,
      subject: composed.subject,
      body: composed.body,
      cc: mandateDraftCc(input.mandateCode),
      threadId: thread.threadId,
      inReplyTo: thread.rfcMessageId,
      references: thread.rfcMessageId,
    });
    const recorded = await recordEmailDraft({
      participationId: part.id,
      gmailDraftId: draft.id,
      gmailThreadId: draft.message?.threadId ?? draft.threadId ?? thread.threadId,
      kind: "chase_closeout",
      chaseNumber: (part.chase_count ?? 0) + 1,
      subject: composed.subject,
      body: composed.body,
    });
    revalidatePath("/chasers");
    return { ok: true, gmailUrl: recorded.gmailUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") return { ok: false, error: "Gmail is not connected." };
    return { ok: false, error: message };
  }
}

export async function createChaserDraftsBatch(input: {
  items: {
    participationId: string;
    mandateCode: MandateCode;
    lastSubject?: string | null;
    lastOccurredAt?: string | null;
  }[];
}): Promise<{ created: number; skipped: number; errors: string[] }> {
  await requireTristan();
  const items = input.items.slice(0, 25);
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const item of items) {
    const result = await createChaserDraft(item);
    if (result.ok) {
      created += 1;
    } else {
      skipped += 1;
      if (errors.length < 12) errors.push(result.error);
    }
  }
  revalidatePath("/chasers");
  return { created, skipped, errors };
}
