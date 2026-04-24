import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier as TrackerEmailTier } from "@/lib/queries/tracker";

/**
 * Data shape returned to the investor detail modal + the draft-template page.
 *
 * Joined-read: one `campaign_partners` row -> partner (partners_mirror) ->
 * investor firm (investors_mirror) -> all sibling partners on the same firm,
 * plus any `contact_events` rows for computing "days since last contact".
 *
 * Every field is intentionally optional at the type level. Real data is
 * sparse — the DB has zero rows in investors_mirror / partners_mirror today,
 * and even when populated, per-firm fields like `connection_brief`, `thesis_summary`,
 * `synthesis_data.portfolio_companies` arrive incrementally from the nightly
 * Forge Capital sync. The UI handles nulls with honest empty states per
 * global rule "Don't advertise problems — show an honest empty state".
 */

// Re-export the canonical tier type defined by Phase 2's tracker.ts so both
// the modal and the tracker agree on one union.
export type EmailTier = TrackerEmailTier;

export interface InvestorModalPartner {
  id: number;
  name: string | null;
  title: string | null;
  email: string | null;
  email_tier: EmailTier;
  bio: string | null;
  focus_areas: string | null;
  /** Campaign-partner row linked to this partner (null if never added to campaign). */
  campaign_partner_id: string | null;
  status_code: string | null;
  status_label: string | null;
  last_contact_at: string | null;
  /** Days since last contact, computed server-side. Null when no contact yet. */
  days_since_last_contact: number | null;
}

export interface InvestorModalData {
  /** The specific tracker row the modal was opened from. */
  campaign_partner_id: string;
  campaign: {
    id: string;
    name: string | null;
    /** User-facing label — see `displayNameFor(campaign)` helper. Null
     *  falls back to `name` at render time. Introduced by migration 027
     *  (UX audit 2026-04-23 item #2). */
    display_name: string | null;
    campaign_intent: "investor" | "customer" | "supplier" | null;
    company_description: string | null;
    raise_size: string | null;
    /** Rule 3 bio — fallback source for credibility paragraph when
     *  email_templates.credibility_paragraph_full is not set. */
    founder_bio: string | null;
    /** Few-shot reference email — forwarded to Opus when refining
     *  synthesis per-investor. */
    voice_reference_email: string | null;
  } | null;
  investor: {
    id: number | null;
    firm_name: string | null;
    website: string | null;
    hq_location: string | null;
    type: string | null;
    thesis_summary: string | null;
    thesis_deep: string | null;
    stage_focus: string | null;
    sector_focus: string | null;
    geo_focus: string | null;
    cheque_min_usd: number | null;
    cheque_max_usd: number | null;
    fund_size_usd: number | null;
    connection_brief: string | null;
    investment_pattern: string | null;
    team_expertise: string | null;
    /** Parsed portfolio companies from synthesis_data jsonb (if present). */
    portfolio_companies: string[];
  };
  /** The partner the tracker row is currently pointed at. */
  primary_partner: InvestorModalPartner | null;
  /** All partners on this investor — includes `primary_partner`. */
  all_partners: InvestorModalPartner[];
  /** Email template for the associated campaign (for the draft page). */
  email_template: {
    credibility_paragraph_full: string | null;
    credibility_paragraph_short: string | null;
    company_paragraph: string | null;
    intelligent_synthesis_template: string | null;
    cta_variant: "20min_call" | "presentation_first" | null;
  } | null;
  /** Opus-rendered per-investor synthesis on the campaign_partners row.
   *  When present, the composer uses this verbatim instead of substituting
   *  {{FIRM_THESIS}} into the template — avoids the verb-chain stumble
   *  Tristan saw 2026-04-23 ("focuses primarily on Pioneered 'SpaceTech'..."). */
  rendered_synthesis: string | null;
  rendered_synthesis_at: string | null;
  /** Opus-produced 2-5 word subject-line angle, cached per-partner. */
  subject_angle: string | null;
}

/**
 * Compute days since a timestamp, rounded down. Returns null for null input.
 */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const msPerDay = 86_400_000;
  return Math.max(0, Math.floor((Date.now() - then) / msPerDay));
}

/**
 * Extract a list of portfolio company names from the investor's
 * `synthesis_data` jsonb. The column is free-form; we try a couple of
 * sensible keys and otherwise return an empty list. Never throws.
 */
function parsePortfolioCompanies(synthesisData: unknown): string[] {
  if (!synthesisData || typeof synthesisData !== "object") return [];
  const bag = synthesisData as Record<string, unknown>;
  const candidateKeys = [
    "portfolio_companies",
    "portfolio",
    "portfolio_highlights",
    "notable_investments",
  ];
  for (const key of candidateKeys) {
    const value = bag[key];
    if (Array.isArray(value)) {
      const names = value
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            const rec = entry as Record<string, unknown>;
            const name = rec.name ?? rec.company ?? rec.firm ?? rec.title;
            return typeof name === "string" ? name : null;
          }
          return null;
        })
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      if (names.length > 0) return names;
    }
  }
  return [];
}

/**
 * Fetch everything the investor detail modal + draft-template page need,
 * joined from `campaign_partners` out to campaign, partner, investor firm,
 * sibling partners, their `campaign_partners` rows inside the same campaign,
 * their `contact_events` for days-since-last-contact, and the campaign's
 * `email_templates` row for draft rendering.
 *
 * Returns `null` if the campaign_partner_id has no row (expected during
 * Phase 3 — DB is empty).
 */
export async function getInvestorModalData(
  campaignPartnerId: string,
): Promise<InvestorModalData | null> {
  if (!campaignPartnerId || typeof campaignPartnerId !== "string") return null;
  const supabase = await createServerClient();

  // 1) Root tracker row + joined campaign + joined partner + partner's
  // investor OR customer. Polymorphic read (migration 030) — depending
  // on partners_mirror.kind, either investors_mirror:investor_id or
  // customers_mirror:customer_id is populated. We join both and
  // coalesce downstream so the same `investor` result slot carries
  // firm metadata regardless of source. Investor-specific fields
  // (thesis_summary, stage_focus, cheque_*, sector_focus, fund_size)
  // are null for customer partners — compose.ts already branches on
  // campaign_intent so those nulls are expected.
  const { data: root, error: rootErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      campaign_id,
      partner_id,
      status_code,
      status_label,
      last_contact_at,
      rendered_synthesis,
      rendered_synthesis_at,
      subject_angle,
      campaign:campaigns (
        id,
        name,
        display_name,
        campaign_intent,
        company_description,
        raise_size,
        founder_bio,
        voice_reference_email
      ),
      partner:partners_mirror (
        id,
        kind,
        investor_id,
        customer_id,
        name,
        title,
        email,
        email_tier,
        bio,
        focus_areas,
        investor:investors_mirror (
          id,
          firm_name,
          website,
          hq_location,
          type,
          thesis_summary,
          thesis_deep,
          stage_focus,
          sector_focus,
          geo_focus,
          cheque_min_usd,
          cheque_max_usd,
          fund_size_usd,
          connection_brief,
          investment_pattern,
          team_expertise,
          synthesis_data
        ),
        customer:customers_mirror (
          id,
          firm_name,
          website,
          hq_location,
          country_iso,
          type,
          channel,
          wave,
          pitch_hook,
          expected_ebitda_gbp,
          bio,
          deep_bio,
          synthesis_data
        )
      )
    `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();

  if (rootErr) {
    console.error("getInvestorModalData root fetch failed:", rootErr.message);
    return null;
  }
  if (!root) return null;

  // Supabase types nested joins as possibly-null or array-shaped depending on
  // FK cardinality. We use `any` to coerce defensively — the query layer is
  // the single place that does this, the rest of the app is strict.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rootAny = root as any;
  const campaignRow = rootAny.campaign ?? null;
  const partnerRow = rootAny.partner ?? null;
  const partnerKind: "investor" | "customer" =
    partnerRow?.kind === "customer" ? "customer" : "investor";
  const investorRow = partnerKind === "investor" ? partnerRow?.investor ?? null : null;
  const customerRow = partnerKind === "customer" ? partnerRow?.customer ?? null : null;

  // Unified "firm" row — what the rest of this function treats as the
  // organisation. For investor partners it IS the investors_mirror row.
  // For customer partners we map customers_mirror fields into the same
  // shape so the downstream return shape is unchanged. This lets
  // compose.ts, test-send, refine-synthesis all continue reading
  // `data.investor.firm_name` etc. without per-kind branching.
  const firmRow = investorRow
    ? investorRow
    : customerRow
      ? {
          id: customerRow.id,
          firm_name: customerRow.firm_name,
          website: customerRow.website,
          hq_location: customerRow.hq_location,
          // Customers_mirror.type is a retail-channel noun (DIY, grower,
          // grocery). Expose as `type`.
          type: customerRow.type,
          // Customer "thesis" analogues — the briefing's pitch_hook
          // describes why we'd sell to them; bio describes the firm.
          thesis_summary: customerRow.pitch_hook ?? customerRow.bio ?? null,
          thesis_deep: customerRow.deep_bio ?? customerRow.bio ?? null,
          stage_focus: null,
          sector_focus: customerRow.channel ?? null,
          geo_focus: customerRow.country_iso ?? null,
          cheque_min_usd: null,
          cheque_max_usd: null,
          fund_size_usd: null,
          connection_brief: customerRow.pitch_hook ?? null,
          investment_pattern: null,
          team_expertise: null,
          synthesis_data: customerRow.synthesis_data,
        }
      : null;

  // 2) Sibling partners on the same firm (includes the primary).
  // Kind-aware: query by investor_id for investor partners, customer_id
  // for customer partners. Both come through the same partners_mirror
  // table post-migration 030.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let siblingRows: any[] = [];
  const firmId = firmRow?.id ?? null;
  if (firmId != null) {
    const siblingQuery = supabase
      .from("partners_mirror")
      .select("id, name, title, email, email_tier, bio, focus_areas")
      .order("is_primary_contact", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true });
    const { data: siblings, error: sibErr } =
      partnerKind === "investor"
        ? await siblingQuery.eq("investor_id", firmId)
        : await siblingQuery.eq("customer_id", firmId);
    if (sibErr) {
      console.error("getInvestorModalData siblings fetch failed:", sibErr.message);
    } else {
      siblingRows = siblings ?? [];
    }
  }

  // 3) For each sibling, fetch their campaign_partners row inside the same
  // campaign (if any) so we can show status + days-since-last-contact in the
  // team section.
  const siblingIds = siblingRows.map((r) => r.id as number);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cpBySibling = new Map<number, any>();
  if (campaignRow?.id && siblingIds.length > 0) {
    const { data: cpRows, error: cpErr } = await supabase
      .from("campaign_partners")
      .select("id, partner_id, status_code, status_label, last_contact_at")
      .eq("campaign_id", campaignRow.id)
      .in("partner_id", siblingIds);
    if (cpErr) {
      console.error("getInvestorModalData campaign_partners fetch failed:", cpErr.message);
    } else {
      for (const row of cpRows ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        cpBySibling.set(r.partner_id as number, r);
      }
    }
  }

  // 4) Email template for this campaign (used by the draft-template page).
  let templateRow: InvestorModalData["email_template"] = null;
  if (campaignRow?.id) {
    const { data: tpl, error: tplErr } = await supabase
      .from("email_templates")
      .select(
        "credibility_paragraph_full, credibility_paragraph_short, company_paragraph, intelligent_synthesis_template, cta_variant",
      )
      .eq("campaign_id", campaignRow.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tplErr) {
      console.error("getInvestorModalData template fetch failed:", tplErr.message);
    } else if (tpl) {
      templateRow = {
        credibility_paragraph_full: tpl.credibility_paragraph_full ?? null,
        credibility_paragraph_short: tpl.credibility_paragraph_short ?? null,
        company_paragraph: tpl.company_paragraph ?? null,
        intelligent_synthesis_template: tpl.intelligent_synthesis_template ?? null,
        cta_variant:
          tpl.cta_variant === "20min_call" || tpl.cta_variant === "presentation_first"
            ? tpl.cta_variant
            : null,
      };
    }
  }

  // Email override lookup. The user-provided email overrides
  // (migration 013) take precedence over the nightly mirror values.
  // RLS scopes the table to the current user's overrides — same
  // pattern as `lib/queries/match-score.ts` post-audit fix. Without
  // this, the draft page renders "no email on file" for partners
  // resolved via the email-hunt modal — surfaced by the Wren
  // walkthrough 2026-04-23.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overrideByPartner = new Map<number, { email: string; email_tier: string }>();
  if (siblingRows.length > 0) {
    const partnerIds = siblingRows.map((r) => r.id as number);
    const { data: overrides } = await supabase
      .from("partner_email_overrides")
      .select("partner_id, email, email_tier")
      .in("partner_id", partnerIds);
    for (const row of (overrides ?? []) as Array<{
      partner_id: number;
      email: string;
      email_tier: string;
    }>) {
      overrideByPartner.set(row.partner_id, {
        email: row.email,
        email_tier: row.email_tier,
      });
    }
  }

  // Normalise the partner list. Apply the email override (if any) so
  // the rest of the app — TierBadge, Create-Gmail-Draft destination,
  // verification-gate filter — sees the user-resolved address.
  const allPartners: InvestorModalPartner[] = siblingRows.map((row) => {
    const cp = cpBySibling.get(row.id as number);
    const override = overrideByPartner.get(row.id as number);
    return {
      id: row.id as number,
      name: (row.name as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      email: override?.email ?? (row.email as string | null) ?? null,
      email_tier: (override?.email_tier ?? (row.email_tier as string | null) ?? null) as EmailTier,
      bio: (row.bio as string | null) ?? null,
      focus_areas: (row.focus_areas as string | null) ?? null,
      campaign_partner_id: cp?.id ?? null,
      status_code: cp?.status_code ?? null,
      status_label: cp?.status_label ?? null,
      last_contact_at: cp?.last_contact_at ?? null,
      days_since_last_contact: daysSince(cp?.last_contact_at),
    };
  });

  // Locate primary partner in the list (the one the tracker row points at).
  const primaryId = partnerRow?.id as number | undefined;
  const primary =
    primaryId != null
      ? allPartners.find((p) => p.id === primaryId) ?? null
      : null;

  // Fill primary-partner-specific fields on the root tracker row.
  if (primary) {
    primary.campaign_partner_id = rootAny.id;
    primary.status_code = rootAny.status_code ?? primary.status_code;
    primary.status_label = rootAny.status_label ?? primary.status_label;
    primary.last_contact_at = rootAny.last_contact_at ?? primary.last_contact_at;
    primary.days_since_last_contact = daysSince(primary.last_contact_at);
  }

  return {
    campaign_partner_id: rootAny.id,
    campaign: campaignRow
      ? {
          id: campaignRow.id,
          name: campaignRow.name ?? null,
          display_name: campaignRow.display_name ?? null,
          campaign_intent:
            campaignRow.campaign_intent === "investor" ||
            campaignRow.campaign_intent === "customer" ||
            campaignRow.campaign_intent === "supplier"
              ? campaignRow.campaign_intent
              : null,
          company_description: campaignRow.company_description ?? null,
          raise_size: campaignRow.raise_size ?? null,
          founder_bio: campaignRow.founder_bio ?? null,
          voice_reference_email: campaignRow.voice_reference_email ?? null,
        }
      : null,
    investor: {
      id: (firmRow?.id as number | null) ?? null,
      firm_name: firmRow?.firm_name ?? null,
      website: firmRow?.website ?? null,
      hq_location: firmRow?.hq_location ?? null,
      type: firmRow?.type ?? null,
      thesis_summary: firmRow?.thesis_summary ?? null,
      thesis_deep: firmRow?.thesis_deep ?? null,
      stage_focus: firmRow?.stage_focus ?? null,
      sector_focus: firmRow?.sector_focus ?? null,
      geo_focus: firmRow?.geo_focus ?? null,
      cheque_min_usd: firmRow?.cheque_min_usd ?? null,
      cheque_max_usd: firmRow?.cheque_max_usd ?? null,
      fund_size_usd: firmRow?.fund_size_usd ?? null,
      connection_brief: firmRow?.connection_brief ?? null,
      investment_pattern: firmRow?.investment_pattern ?? null,
      team_expertise: firmRow?.team_expertise ?? null,
      portfolio_companies: parsePortfolioCompanies(firmRow?.synthesis_data),
    },
    primary_partner: primary,
    all_partners: allPartners,
    email_template: templateRow,
    rendered_synthesis: (rootAny.rendered_synthesis as string | null) ?? null,
    rendered_synthesis_at:
      (rootAny.rendered_synthesis_at as string | null) ?? null,
    subject_angle: (rootAny.subject_angle as string | null) ?? null,
  };
}
