"use server";

import { revalidatePath } from "next/cache";
import { requireTristan } from "@/lib/capital/assert-user";
import { ingestGeminiNotes, listGeminiNotes } from "@/lib/capital/gemini-notes";
import { commitCallNotes, extractCallInsights } from "@/lib/capital/notes-book";
import { createGmailDraft } from "@/lib/gmail/create-draft";

export async function proposeCallNotes(text: string, title?: string) {
  await requireTristan();
  const insights = await extractCallInsights(text, title);
  return { ok: true as const, insights };
}

export async function saveCallNotes(input: { text: string; title?: string }) {
  await requireTristan();
  const result = await commitCallNotes({
    blob: input.text,
    title: input.title ?? "Pasted call notes",
    sourceId: `note:${Date.now()}`,
  });
  revalidatePath("/notes");
  revalidatePath("/today");
  return { ok: true as const, result };
}

export async function createSuggestedDrafts(
  drafts: { to: string; subject: string; body: string; cc?: string[] }[],
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await requireTristan();
  let created = 0;
  try {
    for (const d of drafts) {
      await createGmailDraft({ to: d.to, subject: d.subject, body: d.body, cc: d.cc });
      created++;
    }
    return { ok: true, created };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function importGeminiNotes() {
  await requireTristan();
  const result = await ingestGeminiNotes(8);
  revalidatePath("/notes");
  revalidatePath("/today");
  return result;
}

export async function peekGeminiNotes() {
  await requireTristan();
  return listGeminiNotes();
}
