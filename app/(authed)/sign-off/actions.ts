"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { capitalActor, createEngageClient } from "@/lib/supabase/capital";
import type { MandateCode } from "@/lib/capital/mandates";
import { parseVerdictReply, stageForVerdict } from "@/lib/capital/verdict";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { TRISTAN_EMAIL } from "@/lib/capital/mandates";

export type SignOffLine = {
  n: number;
  participationId: string;
  firmId: string | null;
  personId: string | null;
  firmName: string;
  website: string | null;
  personName: string | null;
  stage: string;
};

export async function createSignOffDraft(input: {
  mandateCode: MandateCode;
  principal: string;
  lines: SignOffLine[];
}): Promise<{ ok: true; gmailUrl: string; body: string } | { ok: false; error: string }> {
  await requireTristan();
  const numbered = input.lines
    .map((l) => `${l.n}. ${l.firmName}${l.website ? ` — ${l.website}` : ""}`)
    .join("\n");
  const body = [
    `${input.principal} — ${input.mandateCode} sign-off.`,
    "",
    "Reply 1 = fine, 2 = cautious, blank = leave it.",
    "",
    numbered,
    "",
    "Best regards,",
    "Tristan Fischer",
  ].join("\n");
  try {
    const draft = await createGmailDraft({
      to: TRISTAN_EMAIL,
      subject: `${input.mandateCode} sign-off packet for ${input.principal}`,
      body,
    });
    const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draft.message?.id ?? draft.id)}`;
    return { ok: true, gmailUrl, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyVerdictPaste(input: {
  mandateCode: MandateCode;
  principal: string;
  pasted: string;
  lines: SignOffLine[];
}): Promise<{ ok: true; updated: number; packetId: string } | { ok: false; error: string }> {
  await requireTristan();
  const parsed = parseVerdictReply(input.pasted, input.lines.length);
  if (parsed.length !== input.lines.length) {
    return { ok: false, error: "Could not parse a verdict for every line." };
  }
  const engage = createEngageClient();
  const { data: mandate } = await engage
    .from("mandates")
    .select("id")
    .eq("code", input.mandateCode)
    .maybeSingle();
  if (!mandate) return { ok: false, error: "Unknown raise." };

  const decisions = input.lines.map((line, i) => ({
    line: line.n,
    participation_id: line.participationId,
    firm_id: line.firmId,
    person_id: line.personId,
    firm_name: line.firmName,
    verdict: parsed[i].verdict,
    reason: parsed[i].reason,
  }));

  const { data: packet, error: pErr } = await engage
    .from("approval_packets")
    .insert({
      mandate_id: mandate.id,
      principal: input.principal,
      method: "paste",
      decided_at: new Date().toISOString(),
      decisions,
      raw_source: input.pasted,
    })
    .select("id")
    .maybeSingle();
  if (pErr || !packet?.id) return { ok: false, error: pErr?.message ?? "Could not save packet." };

  let updated = 0;
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    const v = parsed[i];
    const stage = stageForVerdict(v.verdict, line.stage);
    const noteBits = [
      v.verdict === "fine" ? "principal: fine" : v.verdict === "cautious" ? "principal: cautious" : "principal: leave",
      v.reason,
    ].filter(Boolean);
    const { error } = await engage
      .from("participations")
      .update({
        stage,
        status_note: noteBits.join(" — "),
        approval_packet_id: packet.id,
      })
      .eq("id", line.participationId);
    if (!error) updated++;
  }

  await engage.from("activities").insert({
    occurred_at: new Date().toISOString(),
    channel: "note",
    subject: `${input.mandateCode} sign-off from ${input.principal}`,
    snippet: `${updated} verdicts applied`,
    source_id: `packet:${packet.id}`,
    match_confidence: 1,
    created_by: capitalActor(),
  });

  revalidatePath("/sign-off");
  revalidatePath(`/send/${input.mandateCode}`);
  return { ok: true, updated, packetId: packet.id };
}

