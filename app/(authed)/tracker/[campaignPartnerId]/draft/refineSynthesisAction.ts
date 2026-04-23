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
  | { ok: true; rendered: string }
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
    "You are drafting on behalf of Tristan Fischer, founder of Fractional Forge. You produce a SINGLE paragraph — the per-investor synthesis paragraph of a cold-outreach fundraising email. Voice: first-person, British spelling (organise, behaviour, programme), specific nouns over adjectives, direct, no marketing verbs.",
    "",
    "STRUCTURE — match paragraph 3 of the voice reference EXACTLY:",
    "  1. Open with a hedged-knowledge frame: \"My understanding is that <firm> focuses primarily on <thesis>, with <adjacencies> as the closest adjacencies.\" Choose grammar that chains cleanly — if the thesis starts with a verb (Pioneered / Developed / Built), rephrase it into a noun phrase (e.g. \"their work pioneering <X>\" or \"a thesis centred on <X>\"). Never stitch a verb after \"focuses primarily on\".",
    "  2. If the match is a stretch, admit it plainly: \"If that is right, <topic> is a stretch against that core mandate\".",
    "  3. Name the specific angle you're pitching on: \"I raise it mainly on the <specific adjacency>\".",
    "  4. Invite pushback: \"and would welcome a view on whether that angle holds\".",
    "",
    "BANNED:",
    "  - Bracketed placeholders like [X] / [specific role] / [company] — if a fact is missing, OMIT the clause. The composer has no substitution step for your output — what you write is what ships.",
    "  - Flattery tokens: congratulations, great to see, loved your, enjoyed your, impressive work, excited to see.",
    '  - "The global leader in X" / "defined the category" / similar brand-puff.',
    "  - Inventing facts not present in the context.",
    "",
    "Output ONLY the paragraph. No preamble, no quotes around it, no explanation. 2-4 sentences. No merge tokens — write the firm name and the specifics out in full.",
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
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userPromptLines.join("\n") }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const rendered =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    if (!rendered) {
      return { ok: false, error: "Opus returned an empty synthesis." };
    }

    // Bracket guard.
    const bracketMatch = rendered.match(/\[[^\]\n]{2,60}\]/);
    if (bracketMatch) {
      return {
        ok: false,
        error: `Opus emitted a bracketed placeholder (${bracketMatch[0]}) — click Refine again to retry.`,
      };
    }

    // Write back to campaign_partners.
    const { error: updateErr } = await supabase
      .from("campaign_partners")
      .update({
        rendered_synthesis: rendered,
        rendered_synthesis_at: new Date().toISOString(),
      })
      .eq("id", campaignPartnerId);
    if (updateErr) {
      return { ok: false, error: `DB write failed: ${updateErr.message}` };
    }

    revalidatePath(`/tracker/${campaignPartnerId}/draft`);
    return { ok: true, rendered };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Opus call failed: ${msg}` };
  }
}
