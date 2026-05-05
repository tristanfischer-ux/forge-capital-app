"use client";

import { useState } from "react";
import { SendGmailMessageButton } from "./SendGmailMessageButton";
import { CreateGmailDraftButton } from "./CreateGmailDraftButton";
import { CopyToClipboardButton } from "./CopyToClipboardButton";
import { AttachmentPicker, type PickedFile } from "./AttachmentPicker";

export function DraftActions({
  campaignPartnerId,
  to,
  subject,
  body,
  fullClipboardText,
}: {
  campaignPartnerId: string;
  to: string;
  subject: string;
  body: string;
  fullClipboardText: string;
}) {
  const [files, setFiles] = useState<PickedFile[]>([]);

  const attachments = files.map((f) => ({
    filename: f.name,
    mimeType: f.type,
    base64: f.base64,
  }));

  return (
    <section className="rounded-[10px] border border-border bg-surface-alt p-5">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SendGmailMessageButton
          campaignPartnerId={campaignPartnerId}
          to={to}
          subject={subject}
          body={body}
          attachments={attachments.length > 0 ? attachments : undefined}
        />
        <CreateGmailDraftButton
          to={to}
          subject={subject}
          body={body}
        />
        <CopyToClipboardButton fullText={fullClipboardText} />
      </div>
      <AttachmentPicker files={files} onChange={setFiles} />
      <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
        <strong>Send via Gmail</strong> dispatches immediately (after a
        confirm step). <strong>Create Gmail draft</strong> parks it in
        your Drafts folder for one more review. <strong>Copy to
        clipboard</strong> is the fallback. All three use your
        connected Gmail account.
        {files.length > 0 ? (
          <> Attachments are included with Send via Gmail.</>
        ) : null}
      </p>
    </section>
  );
}
