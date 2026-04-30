import { createServerClient } from "@/lib/supabase/server";
import { renderDraftForPartner } from "@/app/(authed)/drafts/renderDraft";

/**
 * V4 §8 Gmail drafts panel — grouped by campaign.
 *
 * Source: every `campaign_partners` row at `status_code = '+2'` across ALL
 * campaigns (not only the active one). Drafts are composed server-side
 * from the campaign's `email_templates` row against the partner's mirror
 * data — same 4-part structure as the full draft composer at
 * `app/(authed)/tracker/[campaignPartnerId]/draft/compose.ts`, but flattened
 * to the single paragraph + subject that the panel surfaces per row.
 *
 * V1 reality: no rows are at +2 yet. The page renders an honest empty
 * state in that case — this function simply returns an empty array.
 */

/** One draft row rendered in the V4 §8 panel. */
export interface DraftRow {
  partner_id: string;
  partner_name: string | null;
  partner_title: string | null;
  firm_name: string | null;
  subject: string;
  /** First ~160 chars of the rendered body — the "opening line" column. */
  snippet: string;
  /** Full rendered body — initial value for inline editing. */
  full_body: string;
  /** Word-count of the full rendered body (not the snippet). */
  word_count: number;
  /** Short relative-time string: "23m ago" / "2h ago" / "—". */
  saved_ago: string;
  /** Founder-edited subject override (migration 034), or null. */
  draft_subject_override: string | null;
  /** Founder-edited body override (migration 034), or null. */
  draft_body_override: string | null;
}

/** One campaign group in the V4 §8 panel. */
export interface DraftGroup {
  campaign_id: string;
  campaign_name: string;
  campaign_intent: "investor" | "customer" | "supplier";
  drafts: DraftRow[];
}

/** Supabase join row for the +2 tracker pull. */
interface DraftJoinRow {
  id: string;
  campaign_id: string;
  last_contact_at: string | null;
  draft_subject_override: string | null;
  draft_body_override: string | null;
  partners_mirror: {
    name: string | null;
    title: string | null;
    investors_mirror: {
      firm_name: string | null;
      thesis_summary: string | null;
      connection_brief: string | null;
    } | null;
  } | null;
}

/** Supabase row for each campaign we may group under. */
interface CampaignRow {
  id: string;
  name: string | null;
  campaign_intent: "investor" | "customer" | "supplier" | null;
  company_description: string | null;
  raise_size: string | null;
}

/** Supabase row for the email template row used to render a draft. */
interface TemplateRow {
  campaign_id: string;
  credibility_paragraph_full: string | null;
  credibility_paragraph_short: string | null;
  company_paragraph: string | null;
  intelligent_synthesis_template: string | null;
  cta_variant: string | null;
  captured_at: string | null;
}

/**
 * Convert a UTC timestamp into V4's compact relative-time string
 * ("23m ago" / "2h ago" / "3d ago"). Returns an em-dash when the input
 * is missing or unparseable rather than fabricating a time.
 */
function formatSavedAgo(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "—";
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return "—";
  const deltaMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const hours = Math.floor(deltaMin / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Pull all drafts at +2 Drafted across every campaign, grouped by
 * campaign_id. Per-campaign grouping matches the V4 mock's "18 drafts
 * ready in Gmail · 3 campaigns" header + evidence-chip strip.
 *
 * Implementation:
 *   1. Read every +2 row (with firm + partner mirrors).
 *   2. Read every campaign referenced by those rows.
 *   3. Read every email_templates row for those campaigns (one per).
 *   4. Compose each draft server-side and group by campaign.
 *
 * Groups are returned sorted by campaign_name for stable rendering —
 * and within each group, drafts are sorted by most recently-moved
 * (`last_contact_at` DESC) so the freshest drafts appear first.
 */
export async function getDraftsByCampaign(): Promise<DraftGroup[]> {
  const supabase = await createServerClient();

  // 1) +2 tracker rows across every campaign. Includes the draft override
  //    columns added in migration 034 so the inline editor starts from
  //    saved values when present.
  const { data: rowsRaw, error: rowsErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaign_id,
      last_contact_at,
      draft_subject_override,
      draft_body_override,
      partners_mirror:partner_id (
        name,
        title,
        investors_mirror:investor_id (
          firm_name,
          thesis_summary,
          connection_brief
        )
      )
      `,
    )
    .eq("status_code", "+2")
    .order("last_contact_at", { ascending: false, nullsFirst: false });

  if (rowsErr) {
    console.error("getDraftsByCampaign rows fetch failed:", rowsErr.message);
    return [];
  }

  const rows = (rowsRaw ?? []) as unknown as DraftJoinRow[];
  if (rows.length === 0) return [];

  // 2) Campaign rows referenced by any +2 partner.
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id)));
  const [{ data: campaignsRaw, error: campaignsErr }, { data: templatesRaw }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("id, name, campaign_intent, company_description, raise_size")
        .in("id", campaignIds),
      // 3) Latest email_templates row per campaign in scope. One query covers
      //    them all — we filter client-side to the most-recent per campaign
      //    so we mirror the template-resolution rule used by review.ts.
      supabase
        .from("email_templates")
        .select(
          [
            "campaign_id",
            "credibility_paragraph_full",
            "credibility_paragraph_short",
            "company_paragraph",
            "intelligent_synthesis_template",
            "cta_variant",
            "captured_at",
          ].join(","),
        )
        .in("campaign_id", campaignIds)
        .order("captured_at", { ascending: false }),
    ]);

  if (campaignsErr) {
    console.error("getDraftsByCampaign campaigns fetch failed:", campaignsErr.message);
    return [];
  }

  const campaigns = (campaignsRaw ?? []) as unknown as CampaignRow[];
  const templates = (templatesRaw ?? []) as unknown as TemplateRow[];

  // Most-recent template per campaign.
  const templateByCampaign = new Map<string, TemplateRow>();
  for (const t of templates) {
    if (!templateByCampaign.has(t.campaign_id)) {
      templateByCampaign.set(t.campaign_id, t);
    }
  }

  const campaignById = new Map<string, CampaignRow>();
  for (const c of campaigns) campaignById.set(c.id, c);

  // 4) Group + render.
  const groups = new Map<string, DraftGroup>();
  for (const row of rows) {
    const campaign = campaignById.get(row.campaign_id);
    if (!campaign || !campaign.campaign_intent || !campaign.name) continue;

    const template = templateByCampaign.get(row.campaign_id) ?? null;
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;

    const composed = renderDraftForPartner({
      campaign: {
        name: campaign.name,
        company_description: campaign.company_description,
        raise_size: campaign.raise_size,
      },
      template,
      investor: {
        firm_name: investor?.firm_name ?? null,
        thesis_summary: investor?.thesis_summary ?? null,
        connection_brief: investor?.connection_brief ?? null,
      },
    });

    // Prefer founder-edited override values over composed values when
    // present — migration 034 added draft_subject_override +
    // draft_body_override so inline edits on the drafts panel persist.
    const effectiveSubject = row.draft_subject_override ?? composed.subject;
    const effectiveBody = row.draft_body_override ?? composed.full_body;

    const draft: DraftRow = {
      partner_id: row.id,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      firm_name: investor?.firm_name ?? null,
      subject: effectiveSubject,
      snippet: composed.snippet,
      full_body: effectiveBody,
      word_count: effectiveBody.split(/\s+/).filter(Boolean).length,
      saved_ago: formatSavedAgo(row.last_contact_at),
      draft_subject_override: row.draft_subject_override ?? null,
      draft_body_override: row.draft_body_override ?? null,
    };

    const existing = groups.get(campaign.id);
    if (existing) {
      existing.drafts.push(draft);
    } else {
      groups.set(campaign.id, {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        campaign_intent: campaign.campaign_intent,
        drafts: [draft],
      });
    }
  }

  // Stable render order — campaign name A→Z, drafts already in
  // last_contact_at DESC from the initial SELECT.
  return Array.from(groups.values()).sort((a, b) =>
    a.campaign_name.localeCompare(b.campaign_name),
  );
}
