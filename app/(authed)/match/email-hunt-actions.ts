"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Server actions for #69 — the Find-a-Match "Resolve email →" workflow.
 *
 * Two flows:
 *   - `saveEmailOverride`   — user knows the correct email. Writes to
 *                              `partner_email_overrides`, marks as
 *                              `hunter_verified` (user attests) so the
 *                              partner unblocks advancement past +1.
 *   - `queueHunterLookup`   — user doesn't know the email but wants the
 *                              nightly pipeline to prioritise this
 *                              partner's lookup. Writes to
 *                              `partner_email_hunt_requests`.
 *
 * Auth: both actions require a signed-in user. RLS on the tables caps
 * what they can write — they can only touch their own rows.
 */

export interface EmailHuntPartner {
  partner_id: number;
  name: string | null;
  title: string | null;
  current_email: string | null;
  current_tier:
    | "corresponded"
    | "hunter_verified"
    | "unverified"
    | "generic_blocked"
    | "bounced"
    | null;
  override_email: string | null;
  override_tier: string | null;
  hunt_request_status: string | null;
}

export interface EmailHuntResolution {
  firm_name: string | null;
  partners: EmailHuntPartner[];
}

export async function getEmailHuntResolution(input: {
  investorId: number;
}): Promise<
  | { ok: true; data: EmailHuntResolution }
  | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const [firmRes, partnerRes] = await Promise.all([
    supabase
      .from("investors_mirror")
      .select("firm_name")
      .eq("id", input.investorId)
      .maybeSingle(),
    supabase
      .from("partners_mirror")
      .select("id, name, title, email, email_tier, is_primary_contact")
      .eq("investor_id", input.investorId)
      .order("is_primary_contact", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true }),
  ]);

  if (firmRes.error) {
    return { ok: false, error: firmRes.error.message };
  }
  if (partnerRes.error) {
    return { ok: false, error: partnerRes.error.message };
  }

  const partners = (partnerRes.data ?? []) as Array<{
    id: number;
    name: string | null;
    title: string | null;
    email: string | null;
    email_tier: string | null;
    is_primary_contact: boolean | null;
  }>;

  const partnerIds = partners.map((p) => p.id);
  const overridesByPartner = new Map<
    number,
    { email: string; email_tier: string }
  >();
  const huntByPartner = new Map<number, string>();

  if (partnerIds.length > 0) {
    const [overrideRes, huntRes] = await Promise.all([
      supabase
        .from("partner_email_overrides")
        .select("partner_id, email, email_tier")
        .in("partner_id", partnerIds),
      supabase
        .from("partner_email_hunt_requests")
        .select("partner_id, status, requested_at")
        .in("partner_id", partnerIds)
        .order("requested_at", { ascending: false }),
    ]);

    for (const row of (overrideRes.data ?? []) as Array<{
      partner_id: number;
      email: string;
      email_tier: string;
    }>) {
      overridesByPartner.set(row.partner_id, {
        email: row.email,
        email_tier: row.email_tier,
      });
    }

    for (const row of (huntRes.data ?? []) as Array<{
      partner_id: number;
      status: string;
    }>) {
      // Latest-first by order — keep the first one we see per partner.
      if (!huntByPartner.has(row.partner_id)) {
        huntByPartner.set(row.partner_id, row.status);
      }
    }
  }

  const resolved: EmailHuntPartner[] = partners.map((p) => {
    const ov = overridesByPartner.get(p.id);
    return {
      partner_id: p.id,
      name: p.name,
      title: p.title,
      current_email: p.email,
      current_tier: (p.email_tier as EmailHuntPartner["current_tier"]) ?? null,
      override_email: ov?.email ?? null,
      override_tier: ov?.email_tier ?? null,
      hunt_request_status: huntByPartner.get(p.id) ?? null,
    };
  });

  return {
    ok: true,
    data: {
      firm_name: firmRes.data?.firm_name ?? null,
      partners: resolved,
    },
  };
}

function isValidEmail(value: string): boolean {
  // Intentionally permissive — same shape as HTML5 email input validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function saveEmailOverride(input: {
  partnerId: number;
  email: string;
  sourceNote?: string | null;
  tier?: "corresponded" | "hunter_verified" | "unverified";
}): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  const tier = input.tier ?? "hunter_verified";
  const note = input.sourceNote?.trim() || null;

  const { error } = await supabase.from("partner_email_overrides").upsert(
    {
      partner_id: input.partnerId,
      email,
      email_tier: tier,
      source_note: note,
      created_by: user.id,
    },
    { onConflict: "partner_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  // The match-score query may cache; nudge the path.
  revalidatePath("/match");
  return { ok: true };
}

export async function queueHunterLookup(input: {
  partnerId: number;
  notes?: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("partner_email_hunt_requests").insert({
    partner_id: input.partnerId,
    requested_by: user.id,
    notes: input.notes?.trim() || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/match");
  return { ok: true };
}
