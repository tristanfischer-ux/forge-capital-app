import { createServerClient } from "@/lib/supabase/server";

/**
 * Contact directory — every known partners_mirror row for the same
 * organisation (investor or customer) as a given campaign_partners row.
 *
 * Used by the ContactPicker surface on /approval and the tracker
 * drawer. When Tristan wants to swap which person at IKEA or at a
 * Quebec grower he's emailing, we need to surface every known contact
 * at that firm with enough detail (title, bio, email verification
 * state, LinkedIn) for him to make an informed choice.
 *
 * Added 2026-04-24 for the Fischer Farms customer walk — data is
 * already there (6.72 avg contacts per investor firm; 1,538 firms
 * with >10 contacts), the UI surface was the gap.
 */

export interface ContactOption {
  /** partners_mirror.id — swap target for campaign_partners.partner_id. */
  partner_id: number;
  /** Same-kind discriminator — "investor" or "customer". */
  kind: "investor" | "customer";
  name: string | null;
  title: string | null;
  email: string | null;
  /** Hunter-tier verification state. null = never verified; 'guessed' =
   *  inferred pattern; 'verified' = SMTP-confirmed. */
  email_tier: string | null;
  email_verified: boolean | null;
  linkedin: string | null;
  bio: string | null;
  is_primary_contact: boolean | null;
  /** Marks the option currently linked to the campaign_partners row —
   *  the UI highlights this one as "currently reaching out to". */
  is_current: boolean;
}

export interface ContactDirectory {
  /** The organisation kind — drives the header copy. */
  kind: "investor" | "customer";
  /** Firm name for the popover header. */
  firm_name: string | null;
  /** Current partner_id the campaign_partners row points at. */
  current_partner_id: number;
  /** Every partners_mirror row for the same org, ordered:
   *  primary-first, then email-verified, then alphabetical. */
  contacts: ContactOption[];
}

/**
 * Resolve the contact directory for a single campaign_partners row.
 * Returns null when the row doesn't exist or the partner has no
 * org link (shouldn't happen post-migration 030 CHECK).
 */
export async function getContactDirectoryForCampaignPartner(
  campaignPartnerId: string,
): Promise<ContactDirectory | null> {
  if (!campaignPartnerId) return null;
  const supabase = await createServerClient();

  // Step 1: load the current campaign_partners row + its linked
  // partners_mirror (kind + investor_id + customer_id). One round-trip.
  const { data: cp, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      partner_id,
      partners_mirror:partner_id (
        id,
        kind,
        investor_id,
        customer_id,
        investors_mirror:investor_id ( firm_name ),
        customers_mirror:customer_id ( firm_name )
      )
      `,
    )
    .eq("id", campaignPartnerId)
    .maybeSingle();

  if (cpErr) {
    console.error("getContactDirectoryForCampaignPartner cp fetch failed:", cpErr.message);
    return null;
  }

  const row = cp as unknown as {
    id: string;
    partner_id: number | null;
    partners_mirror: {
      id: number;
      kind: "investor" | "customer";
      investor_id: number | null;
      customer_id: number | null;
      investors_mirror: { firm_name: string | null } | null;
      customers_mirror: { firm_name: string | null } | null;
    } | null;
  } | null;
  if (!row?.partners_mirror || !row.partner_id) return null;

  const partner = row.partners_mirror;
  const orgKind = partner.kind;
  const firmName =
    orgKind === "investor"
      ? partner.investors_mirror?.firm_name ?? null
      : partner.customers_mirror?.firm_name ?? null;

  // Step 2: load every partners_mirror row for the same org.
  // Different column names per kind — investor_id vs customer_id.
  const query = supabase
    .from("partners_mirror")
    .select(
      "id, name, title, email, email_tier, email_verified, linkedin, bio, is_primary_contact",
    );

  const { data: contacts, error: contactsErr } = await (orgKind === "investor"
    ? query.eq("investor_id", partner.investor_id)
    : query.eq("customer_id", partner.customer_id));

  if (contactsErr) {
    console.error("getContactDirectoryForCampaignPartner contacts fetch failed:", contactsErr.message);
    return null;
  }

  const options: ContactOption[] = (contacts ?? []).map((c) => {
    const typedRow = c as {
      id: number;
      name: string | null;
      title: string | null;
      email: string | null;
      email_tier: string | null;
      email_verified: boolean | null;
      linkedin: string | null;
      bio: string | null;
      is_primary_contact: boolean | null;
    };
    return {
      partner_id: typedRow.id,
      kind: orgKind,
      name: typedRow.name,
      title: typedRow.title,
      email: typedRow.email,
      email_tier: typedRow.email_tier,
      email_verified: typedRow.email_verified,
      linkedin: typedRow.linkedin,
      bio: typedRow.bio,
      is_primary_contact: typedRow.is_primary_contact,
      is_current: typedRow.id === partner.id,
    };
  });

  // Sort: currently-linked contact first (for reassurance), then
  // primary, then email-verified, then alphabetical.
  options.sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
    if (a.is_primary_contact !== b.is_primary_contact) {
      return a.is_primary_contact ? -1 : 1;
    }
    if (a.email_verified !== b.email_verified) {
      return a.email_verified ? -1 : 1;
    }
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return {
    kind: orgKind,
    firm_name: firmName,
    current_partner_id: partner.id,
    contacts: options,
  };
}
