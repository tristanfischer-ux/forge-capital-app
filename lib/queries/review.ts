import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier } from "@/lib/queries/tracker";

/**
 * One draft row rendered in the V4 §5 Eyeball-review stack
 * (Phase2-Mockup-V4.html lines 1526-1647).
 *
 * Every field is optional at the type level because the real Forge Capital
 * pipeline + Gmail-template capture fills these in incrementally. Missing
 * data resolves to null and the UI shows an em-dash or a placeholder — we
 * never fabricate.
 *
 * `subject_preview` / `body_preview` are derived server-side from the
 * campaign's `email_templates` row (first ~240 chars of the company
 * paragraph + synthesis template). These are PREVIEWS only — the
 * authoritative draft is composed on `/tracker/<id>/draft`.
 */
export interface DraftReviewRow {
  campaign_partner_id: string;
  firm_name: string | null;
  partner_name: string | null;
  partner_title: string | null;
  email_tier: EmailTier;
  /** Derived short subject line — matches the draft-page subject by construction. */
  subject_preview: string | null;
  /** First ~240 chars of the rendered body. Plain text. */
  body_preview: string | null;
}

/**
 * Shape of the Supabase join row, narrowly typed so the mapper stays
 * strict. Supabase's generated types model embedded relations as arrays
 * even for to-one FKs; we cast the payload via `unknown` once at the
 * query boundary.
 */
interface ReviewJoinRow {
  id: string;
  campaign_id: string;
  partners_mirror: {
    name: string | null;
    title: string | null;
    email_tier: string | null;
    investors_mirror: {
      firm_name: string | null;
    } | null;
  } | null;
}

interface TemplateRow {
  campaign_id: string;
  company_paragraph: string | null;
  intelligent_synthesis_template: string | null;
  captured_at: string | null;
}

interface CampaignRow {
  id: string;
  name: string | null;
  company_description: string | null;
  raise_size: string | null;
}

/**
 * Shortens a body-preview string to the first ~240 chars on a whole-word
 * boundary so it reads naturally in the stack. Returns null if input is empty.
 */
function shortenPreview(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[,;:.\-]+$/, "") + "…";
}

/**
 * Derive a subject line for preview purposes. Mirrors the subject logic
 * in app/(authed)/tracker/[campaignPartnerId]/draft/compose.ts so what
 * the reviewer sees in the stack matches what they see on the full draft
 * page. Intentionally simple — stays within 140 chars.
 */
function deriveSubject(campaign: CampaignRow | null): string | null {
  if (!campaign?.name) return null;
  const pitch = campaign.company_description?.trim();
  if (pitch) {
    const firstClause = pitch.split(/[.;\n]/)[0]?.trim();
    if (firstClause) {
      const raise = campaign.raise_size?.trim();
      const tail = raise ? ` (${raise})` : "";
      const base = `${campaign.name} — ${firstClause}${tail}`;
      return base.length > 140 ? base.slice(0, 137) + "…" : base;
    }
  }
  const raise = campaign.raise_size?.trim();
  return raise ? `${campaign.name} (${raise})` : campaign.name;
}

/**
 * Derive the body-preview paragraph. Uses the campaign's email_templates
 * row — `company_paragraph` if present, else `intelligent_synthesis_template`
 * with {{FIRM_NAME}} substituted. Returns null if no template is on file.
 */
function deriveBodyPreview(
  template: TemplateRow | null,
  firmName: string | null,
): string | null {
  if (!template) return null;
  const company = template.company_paragraph?.trim();
  if (company) return shortenPreview(company);
  const synth = template.intelligent_synthesis_template?.trim();
  if (synth) {
    const rendered = firmName
      ? synth.replaceAll("{{FIRM_NAME}}", firmName).replaceAll("{{FIRM_THESIS}}", "—")
      : synth;
    return shortenPreview(rendered);
  }
  return null;
}

/**
 * Fetch all campaign_partners rows at status `+2 Drafted — ready to send`
 * for one campaign, joined to firm + partner + email tier, with preview
 * strings derived from the campaign's email_templates row.
 *
 * Returns [] on any error or when no rows are at +2 — the page renders
 * its honest empty state in that case.
 */
export async function getDraftsReadyForReview(
  campaignId: string,
): Promise<DraftReviewRow[]> {
  if (!campaignId) return [];
  const supabase = await createServerClient();

  // 1) Campaign row — needed for subject derivation.
  const { data: campaignData } = await supabase
    .from("campaigns")
    .select("id, name, company_description, raise_size")
    .eq("id", campaignId)
    .maybeSingle();
  const campaign = (campaignData ?? null) as CampaignRow | null;

  // 2) +2 tracker rows joined out to firm + partner.
  const { data: rowsData, error: rowsErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaign_id,
      partners_mirror:partner_id (
        name,
        title,
        email_tier,
        investors_mirror:investor_id (
          firm_name
        )
      )
      `,
    )
    .eq("campaign_id", campaignId)
    .eq("status_code", "+2");

  if (rowsErr) {
    console.error("getDraftsReadyForReview rows fetch failed:", rowsErr.message);
    return [];
  }

  // 3) Latest email template for this campaign (for preview copy).
  const { data: tplData } = await supabase
    .from("email_templates")
    .select("campaign_id, company_paragraph, intelligent_synthesis_template, captured_at")
    .eq("campaign_id", campaignId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = (tplData ?? null) as TemplateRow | null;

  const rows = (rowsData ?? []) as unknown as ReviewJoinRow[];
  const subject = deriveSubject(campaign);

  return rows.map((row) => {
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;
    return {
      campaign_partner_id: row.id,
      firm_name: investor?.firm_name ?? null,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      email_tier: (partner?.email_tier ?? null) as EmailTier,
      subject_preview: subject,
      body_preview: deriveBodyPreview(template, investor?.firm_name ?? null),
    };
  });
}
