"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import type { SectionKind } from "./types";

/**
 * Templates page — AI drafter server actions (UI-E).
 *
 * Per the global MEMORY.md gotcha, `"use server"` files can ONLY export
 * async functions. Types live in `./types.ts`; const helpers live inline
 * inside action bodies.
 *
 * Model: `claude-opus-4-7` — upgraded from Haiku 4.5 on 2026-04-23 at
 * Tristan's explicit direction: *"The AI writing the emails needs to be
 * Opus 4.7; we cannot have a bad AI writer for that."* Cold-outreach
 * drafting is a voice-critical task where a single word wrong (brackets,
 * flattery, verb chain) costs a real investor relationship — the latency
 * and cost delta vs Haiku is trivially worth it here.
 *
 * Note: approval-reply parsing in `/approval/actions.ts` remains on
 * Haiku for now — that's an extraction task, not a composition task,
 * and Haiku is well-calibrated for it. Revisit if parsing errors
 * appear in telemetry.
 *
 * Key precedence: `process.env.ANTHROPIC_API_KEY` only. Missing key
 * degrades honestly to `{ ok: false, error: "ANTHROPIC_API_KEY not
 * set — add to .env.local" }` rather than throwing. The UI hides the
 * button entirely when the key is absent (page.tsx read of
 * `process.env.ANTHROPIC_API_KEY` at render time), but the action
 * re-checks defensively because env state can drift between render
 * and action call in dev.
 */

const DRAFTER_MODEL = "claude-opus-4-7";

type CampaignContext = {
  id: string;
  name: string;
  campaign_intent: "investor" | "customer" | "supplier";
  company_description: string | null;
  raise_size: string | null;
  founder_bio: string | null;
  voice_reference_email: string | null;
};

type PartnerContext = {
  id: number;
  name: string | null;
  title: string | null;
  firm_name: string | null;
  thesis_summary: string | null;
  thesis_deep: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
};

export type DraftResult =
  | { ok: true; draft: string }
  | { ok: false; error: string };

export type SaveResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server action: draft one section of the email template using Haiku.
 *
 * `partnerId` is optional — if supplied, we load partner context to
 * personalise the per-investor synthesis. For the other three sections
 * (credibility, company, CTA) partner context is ignored at draft time
 * since the template column itself is partner-agnostic.
 */
export async function draftSectionWithHaiku(input: {
  sectionKind: SectionKind;
  campaignId: string;
  partnerId?: number;
}): Promise<DraftResult> {
  const { sectionKind, campaignId, partnerId } = input;

  if (!campaignId) {
    return { ok: false, error: "campaignId is required." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY not set — add to .env.local",
    };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  // Load campaign context. RLS restricts to the signed-in founder.
  // founder_bio + voice_reference_email (migration 020) give Haiku
  // concrete facts + a few-shot exemplar so it doesn't fall back to
  // [bracketed placeholders] when specifics are missing.
  const { data: campaignRow, error: campaignErr } = await supabase
    .from("campaigns")
    .select(
      "id, name, campaign_intent, company_description, raise_size, founder_bio, voice_reference_email",
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignErr) {
    return { ok: false, error: `Campaign read failed: ${campaignErr.message}` };
  }
  if (!campaignRow) {
    return { ok: false, error: "Campaign not found or not accessible." };
  }

  const campaign = campaignRow as unknown as CampaignContext;

  let partner: PartnerContext | null = null;
  if (partnerId && sectionKind === "intelligent_synthesis_template") {
    const { data: partnerRow } = await supabase
      .from("partners_mirror")
      .select(
        "id, name, title, firm_name, thesis_summary, thesis_deep, sector_focus, stage_focus",
      )
      .eq("id", partnerId)
      .maybeSingle();
    partner = (partnerRow ?? null) as unknown as PartnerContext | null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const { system, user: userPrompt } = buildPromptForSection(
      sectionKind,
      campaign,
      partner,
    );

    const response = await client.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the first text block. Haiku returns a content array — for
    // a single-turn non-tool call this is always [{ type: 'text', ... }].
    const textBlock = response.content.find((b) => b.type === "text");
    const draft =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    if (!draft) {
      return { ok: false, error: "Haiku returned an empty draft." };
    }

    // Belt-and-braces guard against the 2026-04-23 bracket failure.
    // The system prompt bans `[bracketed placeholders]` but Haiku is
    // non-deterministic — if it disobeys, we reject here rather than
    // letting brackets reach email_templates and ship to a recipient.
    // CTA section is exempt (it outputs an enum slug like '20min_call'
    // which never contains brackets anyway, but skip the check to
    // avoid any false positive).
    if (sectionKind !== "cta") {
      const bracketMatch = draft.match(/\[[^\]\n]{2,60}\]/);
      if (bracketMatch) {
        return {
          ok: false,
          error: `Haiku emitted a bracketed placeholder (${bracketMatch[0]}) — click Draft again to retry, or fill in the founder bio / voice reference on this campaign so the drafter has concrete facts to use.`,
        };
      }
    }

    return { ok: true, draft };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Haiku call failed: ${msg}` };
  }
}

/**
 * Server action: save the drafted body into `email_templates`.
 *
 * - For `credibility_paragraph` / `company_paragraph` /
 *   `intelligent_synthesis_template` — writes the text into the same-
 *   named column (credibility writes `credibility_paragraph_full`).
 * - For `cta` — body must be one of `20min_call` | `presentation_first`;
 *   writes `cta_variant`.
 *
 * Upserts on `campaign_id` — the templates query reads the most recent
 * row per campaign. If no row exists yet, we insert one.
 */
export async function saveSectionToTemplate(input: {
  sectionKind: SectionKind;
  campaignId: string;
  body: string;
}): Promise<SaveResult> {
  const { sectionKind, campaignId, body } = input;

  if (!campaignId) return { ok: false, error: "campaignId is required." };
  if (typeof body !== "string" || body.trim() === "") {
    return { ok: false, error: "body is empty." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  // Find the most recent email_templates row for this campaign (the one
  // the templates page currently reads). Create one if none exists.
  const { data: existing, error: readErr } = await supabase
    .from("email_templates")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("captured_at", { ascending: false })
    .limit(1);

  if (readErr) {
    return { ok: false, error: `Template read failed: ${readErr.message}` };
  }

  const patch: Record<string, string> = {};
  const trimmed = body.trim();
  switch (sectionKind) {
    case "credibility_paragraph":
      patch.credibility_paragraph_full = trimmed;
      break;
    case "company_paragraph":
      patch.company_paragraph = trimmed;
      break;
    case "intelligent_synthesis_template":
      patch.intelligent_synthesis_template = trimmed;
      break;
    case "cta":
      if (trimmed !== "20min_call" && trimmed !== "presentation_first") {
        return {
          ok: false,
          error:
            "CTA must be '20min_call' or 'presentation_first' (DB constraint).",
        };
      }
      patch.cta_variant = trimmed;
      break;
    default: {
      const exhaustive: never = sectionKind;
      return { ok: false, error: `Unknown sectionKind: ${String(exhaustive)}` };
    }
  }

  const existingRow = (existing ?? [])[0] as { id: string } | undefined;
  if (existingRow) {
    const { error: updErr } = await supabase
      .from("email_templates")
      .update(patch)
      .eq("id", existingRow.id);
    if (updErr) {
      return { ok: false, error: `Template update failed: ${updErr.message}` };
    }
  } else {
    const { error: insErr } = await supabase
      .from("email_templates")
      .insert({ campaign_id: campaignId, ...patch });
    if (insErr) {
      return { ok: false, error: `Template insert failed: ${insErr.message}` };
    }
  }

  // Refresh both the dedicated templates route and the home composite
  // page that includes the section.
  revalidatePath("/templates");
  revalidatePath("/home");
  return { ok: true };
}

/**
 * Server action: save the founder_bio + voice_reference_email columns
 * on `campaigns` for the active raise. These are the two inputs the
 * Opus drafter leans on to produce paragraphs without brackets — they
 * live per-campaign so different raises (Wren vs SkySails vs FishFrom)
 * can emphasise slightly different framings.
 *
 * The UI that calls this is the Voice Reference card on /templates —
 * Tristan pastes his bio + a prior outbound email, saves, the next
 * Redraft pass uses them as context and few-shot.
 */
export async function saveVoiceReference(input: {
  campaignId: string;
  founderBio: string;
  voiceReferenceEmail: string;
}): Promise<SaveResult> {
  const { campaignId, founderBio, voiceReferenceEmail } = input;

  if (!campaignId) return { ok: false, error: "campaignId is required." };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase
    .from("campaigns")
    .update({
      founder_bio: founderBio.trim() || null,
      voice_reference_email: voiceReferenceEmail.trim() || null,
    })
    .eq("id", campaignId);

  if (error) {
    return {
      ok: false,
      error: `Voice reference save failed: ${error.message}`,
    };
  }

  revalidatePath("/templates");
  revalidatePath("/home");
  return { ok: true };
}

export type AuditResult =
  | {
      ok: true;
      rewrite: string;
      recommendations: string[];
    }
  | { ok: false; error: string };

/**
 * Server action: Opus 4.7 audits an existing template paragraph and
 * returns a proposed rewrite + bullet list of what changed and why.
 * Feeds the "Audit with Opus" button on the templates page (Stage 7
 * of the 2026-04-23 audit — *"we should go to edit that ... but also
 * give an AI updated version of it and some recommendations."*).
 *
 * The audit prompt explicitly references the voice markers from the
 * SkySails/Quantonation reference + the 12 Outreach Writing Rules, so
 * Opus grades the current text against a concrete rubric rather than
 * "general writing advice".
 */
export async function auditSectionWithOpus(input: {
  sectionKind: SectionKind;
  campaignId: string;
  currentBody: string;
}): Promise<AuditResult> {
  const { sectionKind, campaignId, currentBody } = input;

  if (!campaignId) return { ok: false, error: "campaignId is required." };
  if (!currentBody || !currentBody.trim()) {
    return { ok: false, error: "No current body to audit — draft first." };
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

  const { data: campaignRow } = await supabase
    .from("campaigns")
    .select(
      "id, name, campaign_intent, company_description, raise_size, founder_bio, voice_reference_email",
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaignRow) return { ok: false, error: "Campaign not found." };
  const campaign = campaignRow as unknown as CampaignContext;

  const sectionLabel =
    sectionKind === "credibility_paragraph"
      ? "credibility paragraph"
      : sectionKind === "company_paragraph"
        ? "company paragraph"
        : sectionKind === "intelligent_synthesis_template"
          ? "per-investor synthesis template"
          : "call-to-action";

  const voiceFrame = campaign.voice_reference_email
    ? `VOICE REFERENCE EMAIL (grade the current draft against the tone, rhythm, and structure of this real prior send):\n---\n${campaign.voice_reference_email}\n---`
    : "VOICE REFERENCE EMAIL: (not set — grade against the rules below only).";

  const bioFrame = campaign.founder_bio
    ? `FOUNDER BIO (the concrete facts that should shape the credibility paragraph):\n${campaign.founder_bio}`
    : "FOUNDER BIO: (not set).";

  const rubric = [
    "The 12 Outreach Writing Rules (summary):",
    "  1. Never assert what a fund does — always hedge (\"My understanding is that...\").",
    "  2. Subject lines tailored per recipient (not applicable to this section).",
    "  3. Bio verbatim, Drax removed (the credibility paragraph).",
    "  5. FishFrom-only video link (not applicable here).",
    "  10. Paragraph order: salutation → bio → company → hedged fund → CTA.",
    "  11. Never congratulate or flatter. Banned tokens: congratulations, great to see, loved your, enjoyed your, impressive work, excited to see.",
    "  12. Sign-off includes LinkedIn URL.",
    "",
    "HARD RULES (from 2026-04-23 bracket failure):",
    "  - NO bracketed placeholders like [X years], [specific role], etc.",
    "  - Double-curly merge tokens {{FIRM_NAME}} / {{FIRM_THESIS}} are allowed (the composer substitutes at send time).",
    "  - British spelling (organise, behaviour, programme).",
    "  - Specific numbers over adjectives.",
  ].join("\n");

  const system = `You are a senior copy editor auditing cold-outreach fundraising emails on Tristan Fischer's behalf. Your job is not to rewrite in your own voice — it is to bring the draft closer to Tristan's real voice (see VOICE REFERENCE EMAIL) while respecting the hard rules. Output a strict JSON object: {"rewrite": "<improved paragraph>", "recommendations": ["<why change 1>", "<why change 2>", ...]}. Output ONLY the JSON object — no prose, no markdown fence, no preamble. British spelling. Never invent facts: if a fact is missing from the context, prefer to OMIT the clause rather than fabricate.\n\n${rubric}`;

  const userPrompt = [
    `SECTION UNDER AUDIT: ${sectionLabel}`,
    "",
    `CAMPAIGN: ${campaign.name} (${campaign.campaign_intent})`,
    campaign.company_description
      ? `COMPANY DESCRIPTION:\n${campaign.company_description}`
      : null,
    campaign.raise_size ? `RAISE SIZE: ${campaign.raise_size}` : null,
    "",
    bioFrame,
    "",
    voiceFrame,
    "",
    "CURRENT DRAFT:",
    "---",
    currentBody.trim(),
    "---",
    "",
    "Task: produce a JSON object with 'rewrite' (the improved paragraph in Tristan's voice, no brackets) and 'recommendations' (2-5 bullets explaining what changed and why — concrete references to the rubric above). If the current draft is already excellent, return {\"rewrite\": \"<current text verbatim>\", \"recommendations\": [\"No material changes needed — the draft matches the voice reference.\"]}.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
    if (!raw) return { ok: false, error: "Opus returned an empty audit." };

    // Strip any accidental markdown fence.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed: { rewrite: unknown; recommendations: unknown };
    try {
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      return {
        ok: false,
        error: `Opus returned non-JSON (${msg}). Raw: ${raw.slice(0, 200)}`,
      };
    }

    if (typeof parsed.rewrite !== "string" || !Array.isArray(parsed.recommendations)) {
      return { ok: false, error: "Opus response was missing rewrite or recommendations." };
    }

    // Same bracket guard as the drafter — audit output must not
    // introduce [placeholders] either.
    if (sectionKind !== "cta") {
      const bracketMatch = parsed.rewrite.match(/\[[^\]\n]{2,60}\]/);
      if (bracketMatch) {
        return {
          ok: false,
          error: `Opus rewrite contained a bracketed placeholder (${bracketMatch[0]}) — re-run the audit.`,
        };
      }
    }

    return {
      ok: true,
      rewrite: parsed.rewrite.trim(),
      recommendations: parsed.recommendations
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.trim())
        .filter(Boolean),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Opus audit failed: ${msg}` };
  }
}

/**
 * Build the (system, user) prompt pair for a section.
 *
 * Voice rules (Outreach-Writing-Rules-TF.md + docs/voice-reference-
 * skysails-quantonation.md):
 *   - British spelling (organise, behaviour, programme)
 *   - First-person, personal, specific numbers over adjectives
 *   - No AI/Smart/Intelligent marketing verbs
 *   - Rule 1: hedged opener in the synthesis section ("My understanding
 *     is that..." or "I am reaching out because...")
 *   - Rule 5: never invent company claims
 *
 * The 2026-04-23 bracket failure: Haiku was previously instructed to
 * emit `[bracketed placeholders]` whenever it lacked specifics. It did
 * exactly that, those brackets were saved into email_templates, the
 * composer rendered them verbatim, and the send button shipped them to
 * Tristan's inbox. The two-part fix:
 *   1. SUPPLY the facts — migration 020 added founder_bio +
 *      voice_reference_email on campaigns so Haiku has concrete
 *      material to quote and a reference for tone.
 *   2. BAN the brackets — the bracket-ban block below is explicit,
 *      repeated per section, and distinguishes forbidden `[...]`
 *      placeholders from allowed `{{MERGE_TOKEN}}` double-curly merge
 *      tokens (which the composer substitutes at send time).
 */
function buildPromptForSection(
  sectionKind: SectionKind,
  campaign: CampaignContext,
  partner: PartnerContext | null,
): { system: string; user: string } {
  const archetype =
    campaign.campaign_intent === "supplier"
      ? "offering-money (supplier)"
      : "asking-for-money (investor or customer)";

  const baseVoice =
    "You are drafting on behalf of Tristan Fischer, founder of Fractional Forge. Voice: first-person, personal, British spelling (organise, behaviour, programme), specific numbers over adjectives, direct, no marketing verbs, no 'AI-powered' / 'Smart' / 'Intelligent'. Output only the drafted paragraph — no preamble, no explanation, no quotes around it, no opening line like 'Here is...'.";

  // The hard rule that stops the 2026-04-23 bracket failure from
  // recurring. Every section's system prompt appends this block.
  const bracketBan = [
    "",
    "HARD RULE — NO BRACKETED PLACEHOLDERS.",
    "You MUST NOT emit square-bracket placeholders like [X years], [specific role], [company name], [sector], [achievement], [number], [TODO], etc. These shipped to a real recipient on 2026-04-23 and the sender called them 'terrible'. If you do not have a specific fact, you have two options — you MUST pick one:",
    "  (A) Use a CONCRETE fact drawn from the FOUNDER BIO, COMPANY DESCRIPTION, RAISE SIZE, or VOICE REFERENCE EMAIL provided below.",
    "  (B) Omit that clause entirely. A shorter, true paragraph beats a longer one with brackets.",
    "You must NEVER invent facts that are not in the context.",
    "",
    "Double-curly merge tokens like {{FIRM_NAME}}, {{FIRM_THESIS}}, {{FIRM_CAPABILITY}} are NOT the same thing — those are app-level template tokens that the composer substitutes at send time. You may emit those when a section explicitly asks for a re-usable template. You must NEVER emit single-bracket `[...]` tokens under any circumstance.",
  ].join("\n");

  const founderFrame = campaign.founder_bio
    ? `FOUNDER BIO (use as the source of truth for the credibility paragraph — do not invent beyond it):\n${campaign.founder_bio}`
    : "FOUNDER BIO: (not set — if drafting the credibility paragraph, return a short honest placeholder asking the founder to set their bio on /templates; do NOT invent a bio and do NOT emit brackets).";

  const voiceFrame = campaign.voice_reference_email
    ? `VOICE REFERENCE EMAIL (this is a real prior send by the founder — match its tone, rhythm, sentence length, and choice of concrete nouns; do NOT copy its specific facts into a different campaign):\n---\n${campaign.voice_reference_email}\n---`
    : "VOICE REFERENCE EMAIL: (not set — rely on the FOUNDER BIO and voice rules above).";

  const campaignFrame = [
    `CAMPAIGN NAME: ${campaign.name}`,
    `INTENT: ${campaign.campaign_intent} (${archetype})`,
    campaign.company_description
      ? `COMPANY DESCRIPTION:\n${campaign.company_description}`
      : "COMPANY DESCRIPTION: (not set)",
    campaign.raise_size ? `RAISE / DEAL SIZE: ${campaign.raise_size}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const sharedContext = [founderFrame, voiceFrame, campaignFrame].join("\n\n");

  switch (sectionKind) {
    case "credibility_paragraph":
      return {
        system: `${baseVoice}\n\nYou are drafting the CREDIBILITY paragraph of a first-contact email. This is the founder's personal bio — who they are and why the recipient should read on. Draft 2-4 sentences in the SAME voice as the VOICE REFERENCE EMAIL below. Stick to facts that appear in the FOUNDER BIO. Match the reference email's rhythm: a dated span (e.g. "twenty-five years"), named employers in sequence with short qualifiers, specific hard numbers, named backers where they add credibility, and a plain cause-and-effect transition to now.${bracketBan}`,
        user: `${sharedContext}\n\nDraft the credibility paragraph using facts from the FOUNDER BIO only. Do not copy the reference email's wording; match its rhythm while using the founder's actual facts.`,
      };

    case "company_paragraph":
      if (campaign.campaign_intent === "supplier") {
        return {
          system: `${baseVoice}\n\nYou are drafting the COMPANY / REQUIREMENT paragraph of a supplier outreach email. Lead with the requirement: spec, volume, timing. 2-4 sentences. Use only facts from the COMPANY DESCRIPTION or RAISE SIZE — if a specific number is missing, omit the clause; do not bracket.${bracketBan}`,
          user: `${sharedContext}\n\nDraft the requirement paragraph.`,
        };
      }
      return {
        system: `${baseVoice}\n\nYou are drafting the COMPANY paragraph of a fundraising (investor or customer) email. Match the rhythm of paragraph 2 in the VOICE REFERENCE EMAIL: founder named + credited, ONE vivid mechanical description of what the company does (a reader should be able to picture it without knowing the sector), a problem-framing clause, a quantitative differentiator if one is in the context, concrete traction in one sentence, and the raise in round numbers with its purpose. 2-5 sentences. Facts must come from COMPANY DESCRIPTION or RAISE SIZE — if a specific is missing, OMIT the clause; do not bracket.${bracketBan}`,
        user: `${sharedContext}\n\nDraft the company paragraph.`,
      };

    case "intelligent_synthesis_template":
      if (campaign.campaign_intent === "supplier") {
        return {
          system: `${baseVoice}\n\nYou are drafting a per-supplier SYNTHESIS paragraph — a capability check against what the recipient's firm is known to do. Open with a hedged-knowledge frame ("My understanding is that your shop handles..."). Use {{FIRM_NAME}} for the firm and {{FIRM_CAPABILITY}} for their known capability (these are merge tokens, not the forbidden single-bracket kind). 2-3 sentences.${bracketBan}`,
          user: `${sharedContext}\n\nDraft a re-usable synthesis template with {{FIRM_NAME}} and {{FIRM_CAPABILITY}} merge tokens.`,
        };
      }
      // asking-for-money synthesis — the most important section.
      // Match paragraph 3 of the SkySails reference: hedged-knowledge
      // frame + honest-stretch admission when applicable + specific
      // angle + invite pushback. {{FIRM_NAME}} / {{FIRM_THESIS}} are
      // merge tokens the composer substitutes per investor.
      const partnerFrame = partner
        ? [
            `SPECIFIC FIRM FOR THIS DRAFT: ${partner.firm_name ?? "(unknown)"}`,
            partner.thesis_summary ? `THESIS SUMMARY: ${partner.thesis_summary}` : null,
            partner.sector_focus ? `SECTOR FOCUS: ${partner.sector_focus}` : null,
            partner.stage_focus ? `STAGE FOCUS: ${partner.stage_focus}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "NO SPECIFIC FIRM PROVIDED — draft a re-usable template using {{FIRM_NAME}} and {{FIRM_THESIS}} merge tokens.";

      return {
        system: `${baseVoice}\n\nYou are drafting the per-investor SYNTHESIS paragraph. Match the structure of paragraph 3 in the VOICE REFERENCE EMAIL EXACTLY:\n  1. Open with the hedged-knowledge frame: "My understanding is that {{FIRM_NAME}} focuses primarily on {{FIRM_THESIS}}, with <adjacencies> as the closest adjacencies." (only name adjacencies if they are present in the thesis context).\n  2. If the match is a stretch, admit it plainly: "If that is right, <topic> is a stretch against that core mandate".\n  3. Name the specific angle you're pitching on: "I raise it mainly on the <specific adjacency>".\n  4. Invite pushback: "and would welcome a view on whether that angle holds".\nNEVER flatter the investor's brand. NEVER claim they are "the global leader in X". The paragraph's job is to demonstrate homework AND honesty, not to sell the fit. Keep to 2-3 sentences. Use {{FIRM_NAME}} and {{FIRM_THESIS}} merge tokens unless a specific firm is given.${bracketBan}`,
        user: `${sharedContext}\n\n${partnerFrame}\n\nDraft the synthesis paragraph.`,
      };

    case "cta":
      return {
        system: `${baseVoice}\n\nYou are choosing the CALL-TO-ACTION variant for this email. Output ONE of exactly these two strings — nothing else, no punctuation, no prose:\n- 20min_call\n- presentation_first\n\nPick '20min_call' when the warmest move is a direct conversation (typical for most cold investor outreach — matches the voice reference email). Pick 'presentation_first' when the recipient would want materials to review before a call.`,
        user: `${campaignFrame}\n\nChoose a CTA variant. Output only the slug.`,
      };

    default: {
      const exhaustive: never = sectionKind;
      throw new Error(`Unhandled sectionKind: ${String(exhaustive)}`);
    }
  }
}
