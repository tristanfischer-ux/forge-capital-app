"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { capitalActor, createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { composeChaserDraft } from "@/lib/capital/voice";
import { createGmailDraft } from "@/lib/gmail/create-draft";

export async function createChaserDraft(input: {
  participationId: string;
  mandateCode: MandateCode;
  lastSubject?: string | null;
  lastOccurredAt?: string | null;
}): Promise<{ ok: true; gmailUrl: string } | { ok: false; error: string }> {
  await requireTristan();
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: part } = await engage
    .from("participations")
    .select("id, person_id, firm_id, stage")
    .eq("id", input.participationId)
    .maybeSingle();
  if (!part?.person_id) return { ok: false, error: "No named person on that row." };
  const [{ data: person }, { data: firm }] = await Promise.all([
    core.from("people").select("id, full_name, email, email_state, dnc").eq("id", part.person_id).maybeSingle(),
    part.firm_id
      ? core.from("firms").select("canonical_name, dnc").eq("id", part.firm_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!person?.email) return { ok: false, error: "No email on this person." };
  if (person.dnc || firm?.dnc) return { ok: false, error: "Do not contact." };
  if (person.email_state !== "verified") {
    return { ok: false, error: `Email is ${person.email_state ?? "unknown"} — verify first.` };
  }
  if (input.mandateCode === "HO") {
    return { ok: false, error: "Hooley is paused — listed, not draftable." };
  }
  const composed = composeChaserDraft({
    personName: person.full_name ?? "",
    firmName: firm?.canonical_name ?? "",
    mandateCode: input.mandateCode,
    lastSubject: input.lastSubject,
    lastOccurredAt: input.lastOccurredAt,
  });
  try {
    const draft = await createGmailDraft({
      to: person.email,
      subject: composed.subject,
      body: composed.body,
      cc: mandateDraftCc(input.mandateCode),
    });
    const { data: activity } = await engage
      .from("activities")
      .insert({
        occurred_at: new Date().toISOString(),
        channel: "draft",
        subject: composed.subject,
        snippet: "Chaser draft",
        source_id: `gmail-draft:${draft.id}`,
        match_confidence: 1,
        created_by: capitalActor(),
      })
      .select("id")
      .maybeSingle();
    if (activity?.id) {
      const links = [
        {
          activity_id: activity.id,
          entity_type: "person",
          entity_id: person.id,
          link_source: "app",
        },
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
    await engage
      .from("participations")
      .update({ latest_touch: new Date().toISOString() })
      .eq("id", input.participationId);
    revalidatePath("/chasers");
    const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draft.message?.id ?? draft.id)}`;
    return { ok: true, gmailUrl };
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
      if (errors.length < 8) errors.push(result.error);
    }
  }
  revalidatePath("/chasers");
  return { created, skipped, errors };
}
