import { listGeminiNotes } from "@/lib/capital/gemini-notes";
import { NotesClient } from "./NotesClient";

export const dynamic = "force-dynamic";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string }>;
}) {
  const title = (await searchParams).title ?? "";
  let files: { id: string; name: string; modified: string }[] = [];
  let needsDriveScope = true;
  try {
    const peek = await listGeminiNotes();
    files = peek.files;
    needsDriveScope = peek.needsDriveScope;
  } catch {
    needsDriveScope = true;
  }
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Call notes</h1>
          <p>
            Dump a transcript. Import Gemini Meet notes. The desk learns the
            person and the company — investors and Yuri RPM customers — then
            suggests thank-you and follow-up drafts. Nothing sends.
          </p>
        </div>
      </div>
      <NotesClient
        geminiFiles={files}
        needsDriveScope={needsDriveScope}
        initialTitle={title}
      />
    </div>
  );
}
