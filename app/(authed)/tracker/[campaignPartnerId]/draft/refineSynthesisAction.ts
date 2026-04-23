"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Server action: generate a per-investor synthesis paragraph with Opus
 * 4.7 and cache it on `campaign_partners.rendered_synthesis`.
 *
 * Why this exists: token substitution on
 * `intelligent_synthesis_template` — replacing {{FIRM_NAME}} /
 * {{FIRM_THESIS}} with column values — produced grammatically broken
 * sentences when the thesis started with a verb ("Pioneered 'SpaceTech'
 * as an investment category"). Opus writes the whole paragraph fresh
 * using the partner's actual firm + thesis + sector as context, matching
 * the hedged-frame rhythm of the voice reference email.
 *
 * Caching is per-partner, on-demand — pressing "Refine with Opus" on
 * the draft page generates and stores. The compose path prefers the
 * cached version over template substitution.
 */

const DRAFTER_MODEL = "claude-opus-4-7";

export interface RefineSynthesisInput {
  campaignPartnerId: string;
}

export type RefineSynthesisResult =
  | { ok: true; rendered: string; subjectAngle: string | null }
  | { ok: false; error: string };

interface Ctx {
  firmName: string | null;
  thesisSummary: string | null;
  sectorFocus: string | null;
  stageFocus: string | null;
  investmentPattern: string | null;
  campaignName: string | null;
  campaignIntent: string | null;
  companyDescription: string | null;
  raiseSize: string | null;
  voiceReferenceEmail: string | null;
}

export async function refineSynthesisWithOpus(
  input: RefineSynthesisInput,
): Promise<RefineSynthesisResult> {
  const { campaignPartnerId } = input;
  if (!campaignPartnerId) {
    return { ok: false, error: "campaignPartnerId is required." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return { ok: false, error: "ANTHROPIC_API_KEY not set." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Pull firm + thesis + campaign + voice reference in one joined read.
  const { data: rootAny, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaign_id,
      campaign:campaigns (
        name,
        campaign_intent,
        company_description,
        raise_size,
        voice_reference_email
      ),
      partner:partners_mirror (
        investor:investors_mirror (
          firm_name,
          thesis_summary,
          sector_focus,
          stage_focus,
          investment_pattern
        )
      )
    `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();

  if (error) return { ok: false, error: `DB read failed: ${error.message}` };
  if (!rootAny) return { ok: false, error: "Partner row not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRow = rootAny as any;
  const investor = anyRow.partner?.investor ?? null;
  const campaign = anyRow.campaign ?? null;

  const ctx: Ctx = {
    firmName: investor?.firm_name ?? null,
    thesisSummary: investor?.thesis_summary ?? null,
    sectorFocus: investor?.sector_focus ?? null,
    stageFocus: investor?.stage_focus ?? null,
    investmentPattern: investor?.investment_pattern ?? null,
    campaignName: campaign?.name ?? null,
    campaignIntent: campaign?.campaign_intent ?? null,
    companyDescription: campaign?.company_description ?? null,
    raiseSize: campaign?.raise_size ?? null,
    voiceReferenceEmail: campaign?.voice_reference_email ?? null,
  };

  if (!ctx.firmName) {
    return { ok: false, error: "No firm_name on investor — cannot synthesise." };
  }

  const system = [
    "You are drafting on behalf of Tristan Fischer, founder of Fractional Forge. You produce TWO things for a cold-outreach email: (1) the per-investor synthesis paragraph, and (2) a 2-5 word subject-line angle tailored to this firm.",
    "",
    "Output ONLY a JSON object matching this schema — no prose, no markdown fence:",
    '  {"synthesis": "<paragraph>", "subject_angle": "<2-5 words>"}',
    "",
    "SYNTHESIS PARAGRAPH — match paragraph 3 of the voice reference EXACTLY:",
    "  1. Open with a hedged-knowledge frame: \"My understanding is that <firm> focuses primarily on <thesis>, with <adjacencies> as the closest adjacencies.\" Choose grammar that chains cleanly — if the thesis starts with a verb (Pioneered / Developed / Built), rephrase it into a noun phrase (e.g. \"their work pioneering <X>\"). Never stitch a verb after \"focuses primarily on\". When possible, cite a specific portfolio company (\"already backing X\") as evidence.",
    "  2. If the match is a stretch, admit it plainly: \"If that is right, <topic> is a stretch against that core mandate\".",
    "  3. Name the specific angle you're pitching on: \"I raise it mainly on the <specific adjacency>\".",
    "  4. Invite pushback: \"and would welcome a view on whether that angle holds\".",
    "  2-4 sentences. Voice: first-person, British spelling (organise, behaviour, programme), specific nouns over adjectives, direct, no marketing verbs.",
    "",
    "SUBJECT ANGLE — 2-5 words, the trailing parenthetical on the subject line. Should be the SINGLE most specific, insightful reason this firm might fit this campaign. Examples from Tristan's canonical style guide:",
    "  • \"DACH deep-tech hardware\" (Alpine Space Ventures / SkySails)",
    "  • \"Airloom / novel wind precedent\" (Crosscut Ventures / SkySails)",
    "  • \"Double Impact / AQ Compute fit\" (Bain Capital / SkySails)",
    "  • \"Deeptech / climate envelope\" (Bpifrance / SkySails)",
    "  • \"climate-tech hardware accelerator\" (Brinc / SkySails)",
    "  • \"foundational-industries thesis\" (Construct Capital / SkySails)",
    "The angle may cite a portfolio-company precedent (like \"Airloom\") if one exists and is relevant. Avoid raw sector-tag lists like \"SaaS, Fintech, Health\".",
    "",
    "BANNED ACROSS BOTH OUTPUTS:",
    "  - Bracketed placeholders like [X] / [specific role] / [company].",
    "  - Flattery tokens: congratulations, great to see, loved your, enjoyed your, impressive work, excited to see.",
    '  - "The global leader in X" / "defined the category" / similar brand-puff.',
    "  - Inventing facts not present in the context.",
  ].join("\n");

  const userPromptLines = [
    `CAMPAIGN: ${ctx.campaignName ?? "(unnamed)"} (intent: ${ctx.campaignIntent ?? "?"})`,
    ctx.companyDescription ? `COMPANY: ${ctx.companyDescription}` : null,
    ctx.raiseSize ? `RAISE: ${ctx.raiseSize}` : null,
    "",
    `INVESTOR FIRM: ${ctx.firmName}`,
    ctx.thesisSummary ? `THESIS SUMMARY (paraphrase, don't verbatim-quote verb starts):\n${ctx.thesisSummary}` : "THESIS SUMMARY: (not set)",
    ctx.sectorFocus ? `SECTOR FOCUS: ${ctx.sectorFocus}` : null,
    ctx.stageFocus ? `STAGE FOCUS: ${ctx.stageFocus}` : null,
    ctx.investmentPattern ? `INVESTMENT PATTERN: ${ctx.investmentPattern}` : null,
    "",
    ctx.voiceReferenceEmail
      ? `VOICE REFERENCE EMAIL (match paragraph 3's rhythm):\n---\n${ctx.voiceReferenceEmail}\n---`
      : "VOICE REFERENCE EMAIL: (not set)",
    "",
    "Task: produce the per-investor synthesis paragraph using the firm + thesis + sector context above, in the voice of the reference email. Use the firm's actual name, not a merge token.",
  ].filter(Boolean);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 1400,
      system,
      messages: [{ role: "user", content: userPromptLines.join("\n") }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    if (!raw) {
      return { ok: false, error: "Opus returned an empty response." };
    }

    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed: { synthesis: unknown; subject_angle: unknown };
    try {
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      return {
        ok: false,
        error: `Opus returned non-JSON (${msg}). Raw: ${raw.slice(0, 200)}`,
      };
    }

    const rendered =
      typeof parsed.synthesis === "string" ? parsed.synthesis.trim() : "";
    const subjectAngle =
      typeof parsed.subject_angle === "string"
        ? parsed.subject_angle.trim() || null
        : null;

    if (!rendered) {
      return { ok: false, error: "Opus returned an empty synthesis." };
    }

    // Bracket guard on both outputs.
    const bracketMatch = rendered.match(/\[[^\]\n]{2,60}\]/);
    if (bracketMatch) {
      return {
        ok: false,
        error: `Opus emitted a bracketed placeholder (${bracketMatch[0]}) — click Refine again to retry.`,
      };
    }
    if (subjectAngle && /\[[^\]\n]{1,40}\]/.test(subjectAngle)) {
      return {
        ok: false,
        error: `Opus subject angle contained brackets (${subjectAngle}) — retry.`,
      };
    }

    // Write back to campaign_partners.
    const { error: updateErr } = await supabase
      .from("campaign_partners")
      .update({
        rendered_synthesis: rendered,
        rendered_synthesis_at: new Date().toISOString(),
        subject_angle: subjectAngle,
      })
      .eq("id", campaignPartnerId);
    if (updateErr) {
      return { ok: false, error: `DB write failed: ${updateErr.message}` };
    }

    revalidatePath(`/tracker/${campaignPartnerId}/draft`);
    return { ok: true, rendered, subjectAngle };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Opus call failed: ${msg}` };
  }
}
