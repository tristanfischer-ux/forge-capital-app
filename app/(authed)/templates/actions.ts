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
 * Model: `claude-haiku-4-5-20251001` — per-section drafting is high-
 * volume and latency-sensitive. Opus would be overkill. If section
 * quality proves too low in practice, swap one section (synthesis) to
 * Sonnet before Opus — telemetry first, model-upgrade second.
 *
 * Key precedence: `process.env.ANTHROPIC_API_KEY` only. Missing key
 * degrades honestly to `{ ok: false, error: "ANTHROPIC_API_KEY not
 * set — add to .env.local" }` rather than throwing. The UI hides the
 * button entirely when the key is absent (page.tsx read of
 * `process.env.ANTHROPIC_API_KEY` at render time), but the action
 * re-checks defensively because env state can drift between render
 * and action call in dev.
 */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

type CampaignContext = {
  id: string;
  name: string;
  campaign_intent: "investor" | "customer" | "supplier";
  company_description: string | null;
  raise_size: string | null;
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
  const { data: campaignRow, error: campaignErr } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent, company_description, raise_size")
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
      model: HAIKU_MODEL,
      max_tokens: 1024,
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
 * Build the (system, user) prompt pair for a section. Kept tight and
 * section-specific — each kind has a different job, so each has its
 * own system prompt and its own user frame.
 *
 * Voice rules come from Outreach-Writing-Rules-TF.md:
 *   - British spelling
 *   - First-person, personal, specific numbers over adjectives
 *   - No AI/Smart/Intelligent marketing verbs
 *   - Rule 1: hedged opener in the synthesis section ("My understanding
 *     is that..." or "I am reaching out because...")
 *   - Rule 5: never invent company claims — if a fact isn't supplied,
 *     leave a `[bracketed placeholder]` so Tristan fills it in.
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
    "You are drafting on behalf of Tristan Fischer, founder of Fractional Forge. Voice: first-person, personal, British spelling (organise, behaviour, programme), specific numbers over adjectives, direct, no marketing verbs, no 'AI-powered' / 'Smart' / 'Intelligent'. Output only the drafted paragraph — no preamble, no explanation, no quotes around it.";

  const campaignFrame = [
    `Campaign: ${campaign.name}`,
    `Intent: ${campaign.campaign_intent} (${archetype})`,
    campaign.company_description
      ? `Company description: ${campaign.company_description}`
      : "Company description: (not set)",
    campaign.raise_size ? `Raise / deal size: ${campaign.raise_size}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  switch (sectionKind) {
    case "credibility_paragraph":
      return {
        system: `${baseVoice}\n\nYou are drafting the CREDIBILITY paragraph of a first-contact email. This is Tristan's personal bio — who he is and why the recipient should read on. Keep it 2-4 sentences. If specific achievements or numbers aren't provided, use [bracketed placeholders] so the sender fills them in — do not invent.`,
        user: `${campaignFrame}\n\nDraft the credibility paragraph.`,
      };

    case "company_paragraph":
      if (campaign.campaign_intent === "supplier") {
        return {
          system: `${baseVoice}\n\nYou are drafting the COMPANY / REQUIREMENT paragraph of a supplier outreach email. Lead with the requirement up front: spec, volume, timing. 2-4 sentences. If specific numbers aren't provided, use [bracketed placeholders] — do not invent specs.`,
          user: `${campaignFrame}\n\nDraft the requirement paragraph.`,
        };
      }
      return {
        system: `${baseVoice}\n\nYou are drafting the COMPANY paragraph of a fundraising (investor or customer) email. Explain what the company does, the stage, and — if relevant — the raise. 2-4 sentences. If specific metrics aren't provided, use [bracketed placeholders] — do not invent.`,
        user: `${campaignFrame}\n\nDraft the company paragraph.`,
      };

    case "intelligent_synthesis_template":
      if (campaign.campaign_intent === "supplier") {
        return {
          system: `${baseVoice}\n\nYou are drafting a per-supplier SYNTHESIS paragraph — a capability check against what the recipient's firm is known to do. Open with a hedge ("My understanding is that your shop handles..." or similar) so we don't assume. Use {{FIRM_NAME}} for the firm and {{FIRM_CAPABILITY}} for their known capability. Keep to 2-3 sentences.`,
          user: `${campaignFrame}\n\nDraft a re-usable synthesis template with {{FIRM_NAME}} and {{FIRM_CAPABILITY}} placeholders.`,
        };
      }
      // asking-for-money synthesis — this is the most important section.
      // Rule 1: hedged opener. Uses {{FIRM_NAME}} and {{FIRM_THESIS}}
      // placeholders.
      const partnerFrame = partner
        ? [
            `Specific firm for this draft: ${partner.firm_name ?? "(unknown)"}`,
            partner.thesis_summary ? `Thesis summary: ${partner.thesis_summary}` : null,
            partner.sector_focus ? `Sector focus: ${partner.sector_focus}` : null,
            partner.stage_focus ? `Stage focus: ${partner.stage_focus}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "No specific firm provided — draft a re-usable template with {{FIRM_NAME}} and {{FIRM_THESIS}} placeholders.";

      return {
        system: `${baseVoice}\n\nYou are drafting a per-investor/customer SYNTHESIS paragraph — a hedged thesis match. Rule 1: open with a hedge like "My understanding is that {{FIRM_NAME}} focuses on..." or "I am reaching out because {{FIRM_THESIS}}...". Use {{FIRM_NAME}} and {{FIRM_THESIS}} as placeholders unless a specific firm is provided. Keep to 2-3 sentences. Never over-claim a match — if the thesis is broad, hedge harder.`,
        user: `${campaignFrame}\n\n${partnerFrame}\n\nDraft the synthesis paragraph.`,
      };

    case "cta":
      return {
        system: `${baseVoice}\n\nYou are choosing the CALL-TO-ACTION variant for this email. Output ONE of exactly these two strings — nothing else, no punctuation, no prose:\n- 20min_call\n- presentation_first\n\nPick '20min_call' when the warmest move is a direct conversation; pick 'presentation_first' when the recipient would want materials to review before a call (typical for cold investor outreach on larger funds).`,
        user: `${campaignFrame}\n\nChoose a CTA variant. Output only the slug.`,
      };

    default: {
      const exhaustive: never = sectionKind;
      throw new Error(`Unhandled sectionKind: ${String(exhaustive)}`);
    }
  }
}
