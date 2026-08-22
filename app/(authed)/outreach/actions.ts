"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { hunterFindEmail } from "@/lib/capital/hunter";
import { verifyPersonEmail } from "@/lib/capital/neverbounce";
import {
  lookalikeCandidates,
  mandateCopy,
  outreachBlocked,
  shapeSamples,
  workingSet,
  type OutreachDraftRow,
} from "@/lib/capital/outreach";
import { MANDATE_CODES, mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { capitalActor, createCoreClient, createEngageClient } from "@/lib/supabase/capital";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { evaluateDraftGate } from "@/lib/capital/draft-gate";
import { composeOutreachDraft } from "@/lib/capital/voice";

function asCode(raw: string): MandateCode | null {
  const c = raw.toUpperCase();
  return (MANDATE_CODES as readonly string[]).includes(c) ? (c as MandateCode) : null;
}

export async function loadOutreach(code: string) {
  await requireTristan();
  const mandate = asCode(code);
  if (!mandate) return { ok: false as const, error: "Unknown programme." };
  const blocked = outreachBlocked(mandate);
  const working = await workingSet(mandate);
  const copy = await mandateCopy(mandate);
  const samples = blocked ? [] : await shapeSamples(mandate);
  return {
    ok: true as const,
    blocked,
    working,
    copy,
    samples,
  };
}

export async function huntOutreach(input: { code: string; n: number; instruction?: string }) {
  await requireTristan();
  const mandate = asCode(input.code);
  if (!mandate) return { ok: false as const, error: "Unknown programme." };
  const blocked = outreachBlocked(mandate);
  if (blocked) return { ok: false as const, error: blocked };
  const n = Math.min(50, Math.max(5, input.n || 20));
  const rows = await lookalikeCandidates(mandate, n, input.instruction);
  return { ok: true as const, rows, n };
}

export async function fillMissingEmail(personId: string, firstName: string, lastName: string, domain: string) {
  await requireTristan();
  const found = await hunterFindEmail({ domain, firstName, lastName });
  if (!found.email) return { ok: false as const, error: "Hunter found no address." };
  const core = createCoreClient();
  await core.from("people").update({ email: found.email, email_state: "unknown" }).eq("id", personId);
  const verified = await verifyPersonEmail(personId);
  return { ok: true as const, email: found.email, email_state: verified.email_state };
}

export async function createOutreachDrafts(input: {
  code: string;
  rows: OutreachDraftRow[];
}): Promise<{ created: number; skipped: number; errors: string[] }> {
  await requireTristan();
  const mandate = asCode(input.code);
  if (!mandate) return { created: 0, skipped: input.rows.length, errors: ["Unknown programme."] };
  const blocked = outreachBlocked(mandate);
  if (blocked) return { created: 0, skipped: input.rows.length, errors: [blocked] };
  const copy = await mandateCopy(mandate);
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const engage = createEngageClient();
  const batch = input.rows.slice(0, 25);
  for (const row of batch) {
    if (row.stage !== "approved") {
      skipped += 1;
      if (errors.length < 8) errors.push(`${row.firmName}: not approved — principal packet, not a draft.`);
      continue;
    }
    if (!row.body || !row.subject || !row.email) {
      skipped += 1;
      continue;
    }
    const gate = await evaluateDraftGate({
      personId: row.personId,
      firmId: row.firmId,
      mandateCode: mandate,
      stage: row.stage,
      body: row.body,
      subject: row.subject,
      opener: row.body,
    });
    if (!gate.allowed) {
      skipped += 1;
      if (errors.length < 8) errors.push(`${row.personName}: ${gate.why}`);
      continue;
    }
    try {
      const composed = row.body
        ? { subject: row.subject, body: row.body }
        : composeOutreachDraft({
            personName: row.personName,
            firmName: row.firmName,
            mandateCode: mandate,
            askSummary: copy.askSummary,
            thesisLine: row.thesisLine,
            warm: gate.warm,
          });
      const draft = await createGmailDraft({
        to: row.email,
        subject: composed.subject,
        body: composed.body,
        cc: mandateDraftCc(mandate),
      });
      const { data: activity } = await engage
        .from("activities")
        .insert({
          occurred_at: new Date().toISOString(),
          channel: "draft",
          subject: composed.subject,
          snippet: "Outreach wave draft",
          source_id: `gmail-draft:${draft.id}`,
          match_confidence: 1,
          created_by: capitalActor(),
        })
        .select("id")
        .maybeSingle();
      if (activity?.id) {
        await engage.from("activity_links").insert({
          activity_id: activity.id,
          entity_type: "person",
          entity_id: row.personId,
          link_source: "app",
        });
      }
      created += 1;
    } catch (err) {
      skipped += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (errors.length < 8) errors.push(message);
    }
  }
  revalidatePath("/outreach");
  return { created, skipped, errors };
}

export async function reshapeOutreach(input: {
  code: string;
  instruction: string;
  rows: OutreachDraftRow[];
}): Promise<{ ok: true; rows: OutreachDraftRow[] } | { ok: false; error: string }> {
  await requireTristan();
  const mandate = asCode(input.code);
  if (!mandate) return { ok: false, error: "Unknown programme." };
  const samples = input.rows.filter((r) => r.sample);
  const hunted = input.rows.filter((r) => !r.sample);
  const nextSamples = await shapeSamples(mandate, input.instruction);
  const nextHunt =
    hunted.length > 0 ? await lookalikeCandidates(mandate, hunted.length, input.instruction) : [];
  return { ok: true, rows: [...(samples.length ? nextSamples : []), ...nextHunt] };
}
