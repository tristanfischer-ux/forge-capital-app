import { NextRequest, NextResponse } from "next/server";
import { parseOffice } from "officeparser";
import { createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/extract-pitch
 *
 * Accepts a multipart upload of a pitch deck / business plan / RFQ
 * document and returns the extracted plain text so the §3 Find-a-Match
 * textarea can be pre-populated. Supported file types (officeparser):
 *   - PDF
 *   - PPTX
 *   - DOCX
 *   - XLSX
 *   - ODT / ODP / ODS
 *
 * V1 scope: return raw extracted text truncated to ~8000 chars. User
 * edits the textarea afterwards. No LLM summarisation — a later phase
 * can wire ANTHROPIC_API_KEY to distill into bullet requirements.
 *
 * Security:
 *   - Auth required (ssr client — the cookie-bound session).
 *   - Max upload 20 MB. officeparser reads in-memory; anything bigger
 *     is a DoS risk on Vercel's 3 GB function memory.
 *   - Extension check against the allow-list. officeparser will still
 *     detect mismatches but the early check gives a cleaner error.
 */

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TEXT_CHARS = 8000;

const ALLOWED_EXTS = new Set([
  "pdf",
  "pptx",
  "docx",
  "xlsx",
  "odt",
  "odp",
  "ods",
  // Plain text passes through without parsing.
  "txt",
  "md",
]);

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Auth guard — only signed-in users can extract. No unauth'd upload.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "No file in form body" },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`,
        },
        { status: 413 },
      );
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported file type: .${ext}. Try PDF, PPTX, DOCX, XLSX, TXT, or MD.`,
        },
        { status: 415 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let extracted: string;
    if (ext === "txt" || ext === "md") {
      extracted = buf.toString("utf8");
    } else {
      try {
        const ast = await parseOffice(buf);
        extracted = typeof ast === "string" ? ast : ast.toText();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown parse error";
        return NextResponse.json(
          {
            ok: false,
            error: `Couldn't parse ${file.name}: ${msg}. Try a different format or paste the text directly.`,
          },
          { status: 422 },
        );
      }
    }

    // Normalise whitespace: collapse runs of spaces + multiple blank lines.
    const cleaned = extracted
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const truncated = cleaned.length > MAX_TEXT_CHARS
      ? cleaned.slice(0, MAX_TEXT_CHARS) + "\n\n[…truncated for matching — full text not used]"
      : cleaned;

    return NextResponse.json({
      ok: true,
      text: truncated,
      bytes: file.size,
      originalChars: cleaned.length,
      filename: file.name,
      extension: ext,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown extraction error";
    console.error("extract-pitch failed:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
