"use server";

import { createGmailDraft } from "@/lib/gmail/create-draft";

/**
 * Server action invoked by the CreateGmailDraftButton on the draft preview
 * page. Pulls the current render (to + subject + body) and calls the Gmail
 * API via the user's stored OAuth refresh_token. Returns the created draft's
 * web URL so the button can open it in a new tab.
 *
 * NOT_CONNECTED error surfaces the "Connect Gmail" affordance client-side.
 */

export interface CreateGmailDraftInput {
  to: string;
  subject: string;
  body: string;
}

export type CreateGmailDraftResult =
  | { ok: true; draftId: string; threadId: string; gmailUrl: string }
  | { ok: false; error: "NOT_CONNECTED" | "CREATE_FAILED"; message: string };

export async function createGmailDraftAction(
  input: CreateGmailDraftInput,
): Promise<CreateGmailDraftResult> {
  try {
    const draft = await createGmailDraft(input);
    // Gmail's UI for viewing/editing a draft:
    const gmailUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.threadId}`;
    return {
      ok: true,
      draftId: draft.id,
      threadId: draft.threadId,
      gmailUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "NOT_CONNECTED") {
      return {
        ok: false,
        error: "NOT_CONNECTED",
        message: "Connect your Gmail account first.",
      };
    }
    return { ok: false, error: "CREATE_FAILED", message: msg };
  }
}
