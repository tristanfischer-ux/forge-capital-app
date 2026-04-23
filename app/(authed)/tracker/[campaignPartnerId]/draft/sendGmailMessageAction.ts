"use server";

import { sendGmailMessage } from "@/lib/gmail/create-draft";

/**
 * Server action invoked by the SendGmailMessageButton on the draft preview
 * page. Sends the rendered draft directly via Gmail API (no detour through
 * the Drafts folder). Tristan asked for this 2026-04-23 during the Wren
 * audit — the existing Create-Gmail-draft flow required leaving the app
 * to send.
 *
 * Caller MUST gate this behind an explicit confirm — V4-FEEDBACK-ROUND-2.md
 * "No auto-send anywhere" rule applies. The button below shows a confirm
 * step before reaching this action.
 */

export interface SendGmailMessageInput {
  to: string;
  subject: string;
  body: string;
}

export type SendGmailMessageResult =
  | { ok: true; messageId: string; threadId: string; gmailUrl: string }
  | { ok: false; error: "NOT_CONNECTED" | "SEND_FAILED"; message: string };

export async function sendGmailMessageAction(
  input: SendGmailMessageInput,
): Promise<SendGmailMessageResult> {
  try {
    const sent = await sendGmailMessage(input);
    // Sent items live under #sent in Gmail's UI.
    const gmailUrl = `https://mail.google.com/mail/u/0/#sent/${sent.threadId}`;
    return {
      ok: true,
      messageId: sent.id,
      threadId: sent.threadId,
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
    return { ok: false, error: "SEND_FAILED", message: msg };
  }
}
