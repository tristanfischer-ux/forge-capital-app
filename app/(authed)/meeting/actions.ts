"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { recordEmailDraft } from "@/lib/capital/email-drafts";
import { mandateDraftCc, type MandateCode } from "@/lib/capital/mandates";
import { createEngageClient } from "@/lib/supabase/capital";
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
    const { data: mandate } = await engage
      .from("mandates")
      .select("id")
      .eq("code", primary)
      .maybeSingle();
    const { data: part } = mandate
      ? await engage
          .from("participations")
          .select("id")
          .eq("person_id", book.personId)
          .eq("mandate_id", mandate.id)
          .maybeSingle()
      : { data: null };
    if (!part?.id) {
      return { ok: false, error: "No participation on the book for this person and programme." };
    }
    const recorded = await recordEmailDraft({
      participationId: part.id,
      gmailDraftId: draft.id,
      gmailThreadId: draft.message?.threadId ?? draft.threadId,
      kind: input.kind === "thank-you" ? "thank_you" : "post_meeting",
      subject: composed.subject,
      body: composed.body,
    });
    revalidatePath(`/meeting/${encodeURIComponent(input.meetingId)}`);
    return { ok: true, gmailUrl: recorded.gmailUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "NOT_CONNECTED") return { ok: false, error: "Gmail is not connected." };
    return { ok: false, error: message };
  }
}
