"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { capitalActor, createEngageClient } from "@/lib/supabase/capital";
import {
  composeCallFollowUpDraft,
  composeThankYouDraft,
} from "@/lib/capital/voice";
import { createGmailDraft } from "@/lib/gmail/create-draft";
import { findDeskMeeting } from "@/lib/queries/find-meeting";
import { resolveMeetingBook } from "@/lib/queries/resolve-meeting";

export async function createCallDraft(input: {
  meetingId: string;
  kind: "thank-you" | "follow-up";
  summary?: string;
}): Promise<{ ok: true; gmailUrl: string } | { ok: false; error: string }> {
  await requireTristan();
  const meeting = await findDeskMeeting(input.meetingId);
  if (!meeting) return { ok: false, error: "That meeting is not on the book this week." };
  const book = await resolveMeetingBook(meeting);
  if (!book.personId || !book.personName) {
    return { ok: false, error: "File the person onto the book first." };
  }
  if (book.personDnc) return { ok: false, error: "Do not contact." };
  if (!book.personEmail) return { ok: false, error: "No email on this person." };
  if (book.personEmailState !== "verified") {
    return {
      ok: false,
      error: `Email is ${book.personEmailState ?? "unknown"} — verify first.`,
    };
  }
  const codes = book.programmes.map((p) => p.code);
  const primary = (codes[0] ?? "SS") as MandateCode;
  const composed =
    input.kind === "thank-you"
      ? composeThankYouDraft({
          personName: book.personName,
          firmName: book.firmName ?? "",
          mandateCodes: codes.length ? codes : [primary],
          callSummary: input.summary ?? null,
        })
      : composeCallFollowUpDraft({
          personName: book.personName,
          firmName: book.firmName ?? "",
          mandateCode: primary,
          nextStep: input.summary ?? null,
        });
  try {
    const draft = await createGmailDraft({
      to: book.personEmail,
      subject: composed.subject,
      body: composed.body,
      cc: mandateDraftCc(primary),
    });
    const engage = createEngageClient();
    const { data: activity } = await engage
      .from("activities")
      .insert({
        occurred_at: new Date().toISOString(),
        channel: "draft",
        subject: composed.subject,
        snippet: input.kind === "thank-you" ? "Thank-you draft" : "Follow-up draft",
        source_id: `gmail-draft:${draft.id}`,
        match_confidence: 1,
        created_by: capitalActor(),
      })
      .select("id")
      .maybeSingle();
    if (activity?.id) {
      const links: {
        activity_id: string;
        entity_type: "person" | "firm";
        entity_id: string;
        link_source: string;
      }[] = [
        {
          activity_id: activity.id,
          entity_type: "person",
          entity_id: book.personId,
          link_source: "app",
        },
      ];
      if (book.firmId) {
        links.push({
          activity_id: activity.id,
          entity_type: "firm",
          entity_id: book.firmId,
          link_source: "app",
        });
      }
      await engage.from("activity_links").insert(links);
    }
    revalidatePath(`/meeting/${encodeURIComponent(input.meetingId)}`);
    const gmailUrl = `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draft.message?.id ?? draft.id)}`;
    return { ok: true, gmailUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") return { ok: false, error: "Gmail is not connected." };
    return { ok: false, error: message };
  }
}
