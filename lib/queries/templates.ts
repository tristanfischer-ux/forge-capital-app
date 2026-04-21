import { createServerClient } from "@/lib/supabase/server";

/**
 * V4 §6 Templates — side-by-side display of the asking-for-money vs
 * offering-money archetype templates for the currently active campaign.
 *
 * Every campaign sits in exactly one archetype via `campaigns.campaign_intent`:
 *   - `investor` + `customer` → asking-for-money
 *   - `supplier`              → offering-money
 *
 * The templates page shows both columns regardless of archetype so the
 * reader sees the full shape of the two families. The column that matches
 * the active campaign's archetype is populated from `email_templates`;
 * the other column is a greyed placeholder (no invented copy — Rule 5).
 *
 * Content is rendered VERBATIM from the DB. SkySails + FishFrom have real
 * captured templates; Panatere / ForgeOS / Fischer Farms Customer are
 * intentionally stubbed with "TODO: needs capture from Gmail" in the seed
 * file. Those TODOs are shown as-is — never replaced with fabricated copy.
 */

/** Archetype family as used on the V4 templates strip. */
export type TemplateArchetype = "asking-for-money" | "offering-money";

/** 4-part structure used by the draft composer (see compose.ts). */
export interface CampaignTemplate {
  /** Campaign that owns this template row. */
  campaign_id: string;
  /** Campaign display name — rendered as the column subtitle. */
  campaign_name: string;
  /** Campaign intent — decides which column this template lands in. */
  campaign_intent: "investor" | "customer" | "supplier";
  /** This template's archetype family (derived from campaign_intent). */
  archetype: TemplateArchetype;
  template_name: string | null;
  credibility_paragraph_full: string | null;
  credibility_paragraph_short: string | null;
  company_paragraph: string | null;
  intelligent_synthesis_template: string | null;
  cta_variant: "20min_call" | "presentation_first" | null;
  captured_from: string | null;
  captured_at: string | null;
}

export interface CampaignTemplates {
  /** Template for the asking-for-money archetype (investor | customer). */
  askingForMoney: CampaignTemplate | null;
  /** Template for the offering-money archetype (supplier). */
  offeringMoney: CampaignTemplate | null;
}

function archetypeFor(
  intent: "investor" | "customer" | "supplier",
): TemplateArchetype {
  return intent === "supplier" ? "offering-money" : "asking-for-money";
}

interface TemplateRow {
  campaign_id: string;
  template_name: string | null;
  credibility_paragraph_full: string | null;
  credibility_paragraph_short: string | null;
  company_paragraph: string | null;
  intelligent_synthesis_template: string | null;
  cta_variant: string | null;
  captured_from: string | null;
  captured_at: string | null;
}

interface CampaignRow {
  id: string;
  name: string | null;
  campaign_intent: "investor" | "customer" | "supplier" | null;
}

/**
 * Load the email_templates row for the given campaign, plus — if the
 * campaign only has a template in one archetype — surface the "other"
 * column as null so the UI can render an honest placeholder.
 *
 * V1 scope: one template per campaign. The active campaign populates
 * whichever column matches its `campaign_intent`; the opposing column
 * is always null. Future work may let a campaign own both shapes
 * (e.g. a hybrid fundraise + supplier RFQ for the same company).
 *
 * Two queries rather than a PostgREST embedded select: keeps the shape
 * boringly predictable and matches the pattern used elsewhere in this
 * codebase (see `investorModal.ts` for the same split).
 */
export async function getCampaignTemplates(
  campaignId: string,
): Promise<CampaignTemplates> {
  const supabase = await createServerClient();

  const [templateResult, campaignResult] = await Promise.all([
    supabase
      .from("email_templates")
      .select(
        [
          "campaign_id",
          "template_name",
          "credibility_paragraph_full",
          "credibility_paragraph_short",
          "company_paragraph",
          "intelligent_synthesis_template",
          "cta_variant",
          "captured_from",
          "captured_at",
        ].join(","),
      )
      .eq("campaign_id", campaignId)
      .order("captured_at", { ascending: false })
      .limit(1),
    supabase
      .from("campaigns")
      .select("id, name, campaign_intent")
      .eq("id", campaignId)
      .maybeSingle(),
  ]);

  if (templateResult.error) {
    console.error(
      "getCampaignTemplates — email_templates read failed:",
      templateResult.error.message,
    );
    return { askingForMoney: null, offeringMoney: null };
  }
  if (campaignResult.error) {
    console.error(
      "getCampaignTemplates — campaigns read failed:",
      campaignResult.error.message,
    );
    return { askingForMoney: null, offeringMoney: null };
  }

  const row = (templateResult.data ?? [])[0] as unknown as TemplateRow | undefined;
  const campaign = campaignResult.data as unknown as CampaignRow | null;

  if (!campaign || !campaign.campaign_intent) {
    return { askingForMoney: null, offeringMoney: null };
  }
  if (!row) {
    // Campaign exists but has no template yet — still tell the caller the
    // archetype so the page can highlight the right side as "needs capture".
    const archetype = archetypeFor(campaign.campaign_intent);
    const emptyTpl: CampaignTemplate = {
      campaign_id: campaignId,
      campaign_name: campaign.name ?? "Campaign",
      campaign_intent: campaign.campaign_intent,
      archetype,
      template_name: null,
      credibility_paragraph_full: null,
      credibility_paragraph_short: null,
      company_paragraph: null,
      intelligent_synthesis_template: null,
      cta_variant: null,
      captured_from: null,
      captured_at: null,
    };
    return {
      askingForMoney: archetype === "asking-for-money" ? emptyTpl : null,
      offeringMoney: archetype === "offering-money" ? emptyTpl : null,
    };
  }

  const intent = campaign.campaign_intent;
  const archetype = archetypeFor(intent);

  const tpl: CampaignTemplate = {
    campaign_id: row.campaign_id,
    campaign_name: campaign.name ?? "Campaign",
    campaign_intent: intent,
    archetype,
    template_name: row.template_name,
    credibility_paragraph_full: row.credibility_paragraph_full,
    credibility_paragraph_short: row.credibility_paragraph_short,
    company_paragraph: row.company_paragraph,
    intelligent_synthesis_template: row.intelligent_synthesis_template,
    cta_variant:
      row.cta_variant === "20min_call" || row.cta_variant === "presentation_first"
        ? row.cta_variant
        : null,
    captured_from: row.captured_from,
    captured_at: row.captured_at,
  };

  return {
    askingForMoney: archetype === "asking-for-money" ? tpl : null,
    offeringMoney: archetype === "offering-money" ? tpl : null,
  };
}
