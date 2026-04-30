import { NextRequest, NextResponse } from "next/server";
import { parseOffice } from "officeparser";
import { callOpenRouter } from "@/lib/openrouter";
import { createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/extract-pitch
 *
 * Two modes:
 *
 *   1. multipart/form-data upload (default, no `mode` param):
 *      accepts a pitch deck / business plan / RFQ document and returns
 *      the extracted plain text so the §3 Find-a-Match textarea can be
 *      pre-populated. Supported file types (officeparser): PDF, PPTX,
 *      DOCX, XLSX, ODT, ODP, ODS, plus plain TXT / MD.
 *
 *   2. `application/json` with `{ mode: "profile", text: "..." }`:
 *      sends the raw text to Anthropic Haiku and asks for a structured
 *      `{ stage, geography, raise_amount, sectors, description }`
 *      object so the hero textarea AND the new filter row can be
 *      pre-filled in one drop. Added 2026-04-22 for the Find-a-Match
 *      "drag-drop dump info" enhancement.
 *
 *      Graceful degradation: if `ANTHROPIC_API_KEY` is not configured
 *      the route returns `{ ok: false, reason: "no_haiku_key",
 *      message: "Profile extraction unavailable — paste into the
 *      textarea instead." }` with a 200 so the client renders a
 *      friendly fallback rather than treating it as a hard error.
 *
 * V1 scope: text extraction (mode 1) returns up to ~8000 chars, user
 * edits afterwards. No LLM summarisation on the upload path — a later
 * phase can wire Haiku in once `ANTHROPIC_API_KEY` is set.
 *
 * Security:
 *   - Auth required (ssr client — the cookie-bound session).
 *   - Max upload 20 MB. officeparser reads in-memory; anything bigger
 *     is a DoS risk on Vercel's 3 GB function memory.
 *   - Extension check against the allow-list. officeparser will still
 *     detect mismatches but the early check gives a cleaner error.
 *   - Profile mode caps input at 16,000 chars to keep Haiku token cost
 *     predictable.
 */

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TEXT_CHARS = 8000;
const MAX_PROFILE_INPUT_CHARS = 16000;

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

/**
 * Shape returned by the `mode=profile` Haiku call. Every field is
 * optional — Haiku may not find all of them in a given snippet.
 */
interface ExtractedProfile {
  stage: string | null;
  geography: string | null;
  raise_amount: string | null;
  sectors: string[];
  description: string | null;
}

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

    // Branch on content-type: JSON body triggers profile-extract mode,
    // multipart triggers the file-upload parser.
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return await handleProfileMode(req);
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

    // Matching Forge Capital's upload flow (research/07b-export-python.py
    // `summariseAndSearch`): after raw-text extraction, fire a Haiku pass
    // that (a) compresses the deck into a 2-3 sentence description and
    // (b) extracts structured match signals (stage/geo/raise/sectors).
    // The client prefers the SUMMARY over the raw text for the hero
    // textarea — a 13,000-char deck dump is noise; the summary is signal.
    // Raw text stays available in the response for an "expand original"
    // affordance on the client.
    const openRouterKeyForSynth = process.env.OPENROUTER_API_KEY?.trim();
    let summary: string | null = null;
    let profile: ExtractedProfile | null = null;
    let haikuUsage: { input_tokens: number | null; output_tokens: number | null } | null = null;
    let haikuError: string | null = null;
    if (openRouterKeyForSynth && cleaned.length >= 40) {
      const synth = await synthesisePitchText(
        cleaned.slice(0, MAX_PROFILE_INPUT_CHARS),
      );
      if (synth.ok) {
        summary = synth.summary;
        profile = synth.profile;
        haikuUsage = synth.usage;
      } else {
        haikuError = synth.error;
      }
    } else if (!openRouterKeyForSynth) {
      haikuError = "OPENROUTER_API_KEY not set — raw text returned without synthesis.";
    }

    // Prefer the summary as the "text" field so the client hero textarea
    // reads the compressed pitch by default. Raw text is always available
    // in `raw_text` so the UI can offer a collapsible "view original".
    const preferredText = summary ?? truncated;

    return NextResponse.json({
      ok: true,
      text: preferredText,
      summary,
      profile,
      raw_text: truncated,
      bytes: file.size,
      originalChars: cleaned.length,
      filename: file.name,
      extension: ext,
      haiku_usage: haikuUsage,
      haiku_error: haikuError,
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

/**
 * `mode=profile` branch — JSON body, Haiku-backed structured extraction.
 *
 * Called when the user drops a piece of text (email, bio, deck snippet)
 * into the "Dump info" box on Find-a-Match. Returns a best-effort
 * `{ stage, geography, raise_amount, sectors, description }` that the
 * client uses to pre-populate both the hero textarea and the new
 * filter row in one step.
 */
async function handleProfileMode(req: NextRequest): Promise<NextResponse> {
  let body: { mode?: string; text?: string };
  try {
    body = (await req.json()) as { mode?: string; text?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (body.mode !== "profile") {
    return NextResponse.json(
      { ok: false, error: "Unsupported mode — expected 'profile'" },
      { status: 400 },
    );
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Empty text" },
      { status: 400 },
    );
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!openRouterKey) {
    // Graceful degradation path — client falls back to "paste into the
    // textarea" behaviour. Return 200 so the fetch resolves cleanly.
    return NextResponse.json({
      ok: false,
      reason: "no_haiku_key",
      message:
        "Profile extraction unavailable — pasting the text into the textarea instead.",
    });
  }

  const capped = text.slice(0, MAX_PROFILE_INPUT_CHARS);
  try {
    const rawText = await callOpenRouter({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 16000,
      messages: [
        {
          role: "system",
          content:
            "You extract structured fundraising / matching signals from arbitrary founder text (decks, emails, bios, product briefs). Return ONLY a JSON object that matches the requested schema — no prose, no markdown fence. British spelling. Do not invent values: if a field is not in the text, return null (or [] for sectors).",
        },
        {
          role: "user",
          content:
            "Extract these fields from the snippet below and return a single JSON object with exactly these keys:\n" +
            "- stage: one of 'Pre-seed' | 'Seed' | 'Series A' | 'Series B' | 'Growth' | null\n" +
            "- geography: one of 'UK' | 'EU' | 'US' | 'Global' | null\n" +
            "- raise_amount: short string (e.g. '£500K-£2M', '$10M+', '€2M') or null\n" +
            "- sectors: array of short sector tags (e.g. ['maritime', 'energy']) — empty array if unclear\n" +
            "- description: one cleaned-up paragraph (<= 600 chars) describing the company and the round, or null if the text is too thin\n\n" +
            "SNIPPET:\n" +
            capped,
        },
      ],
    });

    // Strip any accidental ```json fences.
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed: ExtractedProfile;
    try {
      const raw = JSON.parse(cleaned) as Record<string, unknown>;
      parsed = {
        stage: typeof raw.stage === "string" ? raw.stage : null,
        geography: typeof raw.geography === "string" ? raw.geography : null,
        raise_amount:
          typeof raw.raise_amount === "string" ? raw.raise_amount : null,
        sectors: Array.isArray(raw.sectors)
          ? raw.sectors.filter((s): s is string => typeof s === "string")
          : [],
        description:
          typeof raw.description === "string" ? raw.description : null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      return NextResponse.json(
        {
          ok: false,
          error: `Haiku returned a response we couldn't parse as JSON (${msg}). Try pasting the text directly.`,
          raw: rawText.slice(0, 200),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      profile: parsed,
      usage: {
        input_tokens: null,
        output_tokens: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown extraction error";
    console.error("extract-pitch profile mode failed:", msg);
    return NextResponse.json(
      { ok: false, error: `Extraction call failed: ${msg}` },
      { status: 502 },
    );
  }
}

/**
 * Shared synthesis helper — one Haiku call returns both:
 *   - a 2-3 sentence description (matching Forge Capital's `summariseForSearch`)
 *   - the structured profile fields for filter auto-fill
 *
 * Single call keeps latency + cost down versus two round-trips. The
 * prompt explicitly asks Haiku to output one JSON object with BOTH a
 * `description` (the summary) and the structured signals.
 */
async function synthesisePitchText(
  text: string,
): Promise<
  | {
      ok: true;
      summary: string;
      profile: ExtractedProfile;
      usage: { input_tokens: number | null; output_tokens: number | null };
    }
  | { ok: false; error: string }
> {
  try {
    const raw = await callOpenRouter({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 16000,
      messages: [
        {
          role: "system",
          content:
            "You extract match signals from a founder's pitch deck text. Output ONLY one JSON object matching the requested schema — no prose, no markdown fence. British spelling. Never invent values: if a field is genuinely absent from the text, return null (or [] for sectors). Description should read like a pitch elevator paragraph — what the company does, stage, sector, geography, raise size — not a summary of the document structure.",
        },
        {
          role: "user",
          content:
            "You are helping a startup founder find investors. Below is text extracted from their pitch deck or business plan. Extract a concise 2-3 sentence description of what this company does, what stage they are at, what sector they're in, where they're based, and how much they're raising (if mentioned). Also extract structured match signals into a single JSON object with exactly these keys:\n" +
            "- description: 2-3 sentence elevator pitch (<= 600 chars). This replaces the deck text in the match textarea, so write it as a crisp pitch paragraph — NOT 'this deck covers X'. Null only if the text is too thin to summarise.\n" +
            "- stage: one of 'Pre-seed' | 'Seed' | 'Series A' | 'Series B' | 'Growth' | null\n" +
            "- geography: one of 'UK' | 'EU' | 'US' | 'Global' | null\n" +
            "- raise_amount: short string (e.g. '£500K-£2M', '$10M+', '€2M') or null\n" +
            "- sectors: array of short sector tags (e.g. ['maritime', 'energy']) — empty array if unclear\n\n" +
            "DECK TEXT:\n" +
            text,
        },
      ],
    });
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const description = typeof obj.description === "string" ? obj.description : null;
    if (!description) {
      return {
        ok: false,
        error: "Haiku returned no description — deck text too thin",
      };
    }

    return {
      ok: true,
      summary: description,
      profile: {
        stage: typeof obj.stage === "string" ? obj.stage : null,
        geography: typeof obj.geography === "string" ? obj.geography : null,
        raise_amount:
          typeof obj.raise_amount === "string" ? obj.raise_amount : null,
        sectors: Array.isArray(obj.sectors)
          ? obj.sectors.filter((s): s is string => typeof s === "string")
          : [],
        description,
      },
      usage: {
        input_tokens: null,
        output_tokens: null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown extraction error",
    };
  }
}
