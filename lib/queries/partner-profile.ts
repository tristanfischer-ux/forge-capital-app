import { createServerClient } from "@/lib/supabase/server";
import type { EmailTier } from "@/lib/queries/tracker";

/**
 * Profile-page data loader — reads a single partner row by bare numeric id
 * from `partners_mirror` plus the firm block (investors_mirror), the other
 * partners at the same firm (siblings), any visible `campaign_partners`
 * rows for this partner (RLS-scoped) and the last 20 `contact_events`
 * across those campaign partner rows. Used by `/partner/[id]`.
 *
 * Stylistic twin of `lib/queries/investor-profile.ts`: same `daysSince()`
 * helper, same defensive `as unknown as <Shape>[]` casts at the query
 * boundary.
 */

export type ContactEventDirection =
  | "inbound"
  | "outbound"
  | "manual"
  | "bounce"
  | "auto_reply"
  | null;

export interface PartnerProfileFirm {
  id: number | null;
  firm_name: string | null;
  website: string | null;
  hq_location: string | null;
  thesis_summary: string | null;
  stage_focus: string | null;
  sector_focus: string | null;
  geo_focus: string | null;
}

export interface PartnerProfileSibling {
  id: number;
  name: string | null;
  title: string | null;
  email_tier: EmailTier;
  is_primary_contact: boolean;
}

export interface PartnerProfileCampaignLink {
  campaign_partner_id: string;
  campaign_id: string;
  campaign_name: string | null;
  status_code: string | null;
  status_label: string | null;
  last_contact_at: string | null;
  days_since_last_contact: number | null;
  approver_note: string | null;
}

export interface PartnerProfileEvent {
  id: string;
  direction: ContactEventDirection;
  channel: string | null;
  event_at: string | null;
  summary: string | null;
}

export interface PartnerCrossFirmMatch {
  /** Partner row id on the OTHER firm (navigates to /partner/[id]). */
  id: number;
  firm_id: number | null;
  firm_name: string | null;
  title: string | null;
  /** 'email' = same email address (strong match, definitely same person).
   *  'name' = same normalised name but different email (possibly same
   *  person, possibly a name collision — UI labels clearly). */
  match_kind: "email" | "name";
}

/**
 * Free-form jsonb returned by the email-verification subsystem (Hunter or
 * NeverBounce, depending on which probe wrote the row last). Stored as
 * jsonb on `partners_mirror.email_verifier_raw`. Shape varies by provider:
 * NeverBounce typically writes `{ result, code, role, free_email, ... }`,
 * Hunter writes `{ status, score, regexp, gibberish, ... }`. We surface
 * the raw object for the UI so the provenance card can render whichever
 * shape lands.
 */
export type EmailVerifierRaw = Record<string, unknown> | null;

export interface PartnerProfileData {
  id: number;
  name: string | null;
  title: string | null;
  email: string | null;
  email_tier: EmailTier;
  /** ISO timestamp the tier landed (set by the verifier writing the row).
   *  Drives the "Verified by X · Yh ago" provenance line. */
  email_tier_at: string | null;
  /** Hunter or NeverBounce method label, when stored. */
  email_verified_method: string | null;
  /** Raw verifier payload — provider-shaped jsonb, see EmailVerifierRaw. */
  email_verifier_raw: EmailVerifierRaw;
  linkedin: string | null;
  twitter: string | null;
  bio: string | null;
  deep_bio: string | null;
  focus_areas: string | null;
  is_primary_contact: boolean;
  last_synced_at: string | null;
  firm: PartnerProfileFirm | null;
  siblings: PartnerProfileSibling[];
  /** Same-person or same-name matches at OTHER firms — closes the
   *  partner → firm → partner hop in the graph. Email matches are
   *  strong (same person); name-only matches are labelled as
   *  "possibly" so the UI doesn't fabricate a certainty. */
  cross_firm: PartnerCrossFirmMatch[];
  campaign_links: PartnerProfileCampaignLink[];
  recent_events: PartnerProfileEvent[];
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export async function getPartnerProfile(
  partnerId: number,
): Promise<PartnerProfileData | null> {
  if (!Number.isFinite(partnerId)) return null;
  const supabase = await createServerClient();

  const { data: partner, error: partnerErr } = await supabase
    .from("partners_mirror")
    .select(
      `id, investor_id, name, title, email, email_tier, email_tier_at,
       email_verified_method, email_verifier_raw, linkedin, twitter,
       bio, deep_bio, focus_areas, is_primary_contact, last_synced_at`,
    )
    .eq("id", partnerId)
    .maybeSingle();

  if (partnerErr) {
    console.error("getPartnerProfile partner fetch failed:", partnerErr.message);
    return null;
  }
  if (!partner) return null;

  const partnerRow = partner as unknown as {
    id: number;
    investor_id: number | null;
    name: string | null;
    title: string | null;
    email: string | null;
    email_tier: string | null;
    email_tier_at: string | null;
    email_verified_method: string | null;
    email_verifier_raw: EmailVerifierRaw;
    linkedin: string | null;
    twitter: string | null;
    bio: string | null;
    deep_bio: string | null;
    focus_areas: string | null;
    is_primary_contact: boolean | null;
    last_synced_at: string | null;
  };

  // Firm block — may be absent if partner isn't wired to investors_mirror
  // (orphan row; honest empty-state rendered in the view).
  let firm: PartnerProfileFirm | null = null;
  if (partnerRow.investor_id != null) {
    const { data: firmRow, error: firmErr } = await supabase
      .from("investors_mirror")
      .select(
        `id, firm_name, website, hq_location,
         thesis_summary, stage_focus, sector_focus, geo_focus`,
      )
      .eq("id", partnerRow.investor_id)
      .maybeSingle();
    if (firmErr) {
      console.error("getPartnerProfile firm fetch failed:", firmErr.message);
    } else if (firmRow) {
      const row = firmRow as unknown as {
        id: number;
        firm_name: string | null;
        website: string | null;
        hq_location: string | null;
        thesis_summary: string | null;
        stage_focus: string | null;
        sector_focus: string | null;
        geo_focus: string | null;
      };
      firm = {
        id: row.id,
        firm_name: row.firm_name,
        website: row.website,
        hq_location: row.hq_location,
        thesis_summary: row.thesis_summary,
        stage_focus: row.stage_focus,
        sector_focus: row.sector_focus,
        geo_focus: row.geo_focus,
      };
    }
  }

  // Siblings — other partners at the same firm.
  let siblings: PartnerProfileSibling[] = [];
  if (partnerRow.investor_id != null) {
    const { data: siblingRows, error: siblingsErr } = await supabase
      .from("partners_mirror")
      .select("id, name, title, email_tier, is_primary_contact")
      .eq("investor_id", partnerRow.investor_id)
      .neq("id", partnerRow.id)
      .order("is_primary_contact", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true });
    if (siblingsErr) {
      console.error(
        "getPartnerProfile siblings fetch failed:",
        siblingsErr.message,
      );
    } else {
      const rows = (siblingRows ?? []) as unknown as Array<{
        id: number;
        name: string | null;
        title: string | null;
        email_tier: string | null;
        is_primary_contact: boolean | null;
      }>;
      siblings = rows.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        email_tier: (r.email_tier ?? null) as EmailTier,
        is_primary_contact: Boolean(r.is_primary_contact),
      }));
    }
  }

  // Campaign links — every campaign_partners row the current user can see
  // (RLS caps the set). Used to render campaign activity + fetch events.
  let campaignLinks: PartnerProfileCampaignLink[] = [];
  const { data: cpRows, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `id, campaign_id, status_code, status_label, last_contact_at, approver_note,
       campaigns:campaign_id ( id, name )`,
    )
    .eq("partner_id", partnerRow.id)
    .order("last_contact_at", { ascending: false, nullsFirst: false });
  if (cpErr) {
    console.error(
      "getPartnerProfile campaign_partners fetch failed:",
      cpErr.message,
    );
  } else {
    const rows = (cpRows ?? []) as unknown as Array<{
      id: string;
      campaign_id: string;
      status_code: string | null;
      status_label: string | null;
      last_contact_at: string | null;
      approver_note: string | null;
      campaigns: { id: string; name: string | null } | null;
    }>;
    campaignLinks = rows.map((r) => ({
      campaign_partner_id: r.id,
      campaign_id: r.campaign_id,
      campaign_name: r.campaigns?.name ?? null,
      status_code: r.status_code,
      status_label: r.status_label,
      last_contact_at: r.last_contact_at,
      days_since_last_contact: daysSince(r.last_contact_at),
      approver_note: r.approver_note,
    }));
  }

  // Recent events — joined via campaign_partner_id on every visible
  // campaign_partners row for this partner. Capped at 20.
  let recentEvents: PartnerProfileEvent[] = [];
  const cpIds = campaignLinks.map((l) => l.campaign_partner_id);
  if (cpIds.length > 0) {
    const { data: eventRows, error: eventErr } = await supabase
      .from("contact_events")
      .select("id, direction, channel, event_at, summary")
      .in("campaign_partner_id", cpIds)
      .order("event_at", { ascending: false, nullsFirst: false })
      .limit(20);
    if (eventErr) {
      console.error(
        "getPartnerProfile contact_events fetch failed:",
        eventErr.message,
      );
    } else {
      const rows = (eventRows ?? []) as unknown as Array<{
        id: string;
        direction: string | null;
        channel: string | null;
        event_at: string | null;
        summary: string | null;
      }>;
      recentEvents = rows.map((r) => ({
        id: r.id,
        direction: (r.direction ?? null) as ContactEventDirection,
        channel: r.channel,
        event_at: r.event_at,
        summary: r.summary,
      }));
    }
  }

  // Cross-firm matches — partners at OTHER firms who share this
  // partner's email (strong, definitely same person) or name
  // (possibly same person). 418 email collisions + 3,120 name
  // collisions exist today; the UI labels each match's strength
  // honestly so "possibly" rows don't fabricate a certainty.
  const crossFirm: PartnerCrossFirmMatch[] = [];
  const emailKey = partnerRow.email?.trim().toLowerCase() ?? "";
  const nameKey = partnerRow.name?.trim().toLowerCase() ?? "";

  async function collectCrossFirm(
    filter: "email" | "name",
  ): Promise<void> {
    const query = supabase
      .from("partners_mirror")
      .select(
        `id, name, title, email,
         investors_mirror:investor_id ( id, firm_name )`,
      )
      .neq("id", partnerRow.id)
      .limit(50);
    const { data: rows, error } =
      filter === "email"
        ? await query.ilike("email", emailKey)
        : await query.ilike("name", nameKey);
    if (error) {
      console.error(
        `getPartnerProfile cross_firm ${filter} fetch failed:`,
        error.message,
      );
      return;
    }
    const typed = (rows ?? []) as unknown as Array<{
      id: number;
      name: string | null;
      title: string | null;
      email: string | null;
      investors_mirror: { id: number; firm_name: string | null } | null;
    }>;
    for (const r of typed) {
      // Exclude anyone at the SAME firm (they show up as siblings).
      if (
        r.investors_mirror?.id != null &&
        r.investors_mirror.id === partnerRow.investor_id
      ) {
        continue;
      }
      // Dedup by partner id — same person might match on both email +
      // name; keep the first appearance (email is stronger, so email
      // run goes first).
      if (crossFirm.some((c) => c.id === r.id)) continue;
      crossFirm.push({
        id: r.id,
        firm_id: r.investors_mirror?.id ?? null,
        firm_name: r.investors_mirror?.firm_name ?? null,
        title: r.title,
        match_kind: filter,
      });
    }
  }

  if (emailKey && emailKey.length > 3 && emailKey.includes("@")) {
    await collectCrossFirm("email");
  }
  if (nameKey && nameKey.length > 3) {
    await collectCrossFirm("name");
  }

  return {
    id: partnerRow.id,
    name: partnerRow.name,
    title: partnerRow.title,
    email: partnerRow.email,
    email_tier: (partnerRow.email_tier ?? null) as EmailTier,
    email_tier_at: partnerRow.email_tier_at ?? null,
    email_verified_method: partnerRow.email_verified_method ?? null,
    email_verifier_raw:
      (partnerRow.email_verifier_raw as EmailVerifierRaw) ?? null,
    linkedin: partnerRow.linkedin,
    twitter: partnerRow.twitter,
    bio: partnerRow.bio,
    deep_bio: partnerRow.deep_bio,
    focus_areas: partnerRow.focus_areas,
    is_primary_contact: Boolean(partnerRow.is_primary_contact),
    last_synced_at: partnerRow.last_synced_at,
    firm,
    siblings,
    cross_firm: crossFirm.slice(0, 20),
    campaign_links: campaignLinks,
    recent_events: recentEvents,
  };
}
