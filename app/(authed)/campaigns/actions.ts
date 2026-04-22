"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Server action: update editable campaign metadata.
 * Scope (columns added by migration 012):
 *   counterpart_name / counterpart_email / counterpart_role
 *   week_started_at (YYYY-MM-DD or null)
 *   week_count_target (int or null — defaults to 16 if null)
 *
 * Authed: the ssr client carries the user's session cookie; RLS
 * (migration 011_multi_user_rls.sql) gates UPDATE on `campaigns` to
 * founders only. If the caller isn't a founder, the UPDATE returns
 * 0 affected rows and we report a clean "not permitted" error.
 */
export type UpdateCampaignMetadataResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateCampaignMetadata(input: {
  campaignId: string;
  counterpartName: string | null;
  counterpartEmail: string | null;
  counterpartRole: string | null;
  weekStartedAt: string | null;
  weekCountTarget: number | null;
}): Promise<UpdateCampaignMetadataResult> {
  const {
    campaignId,
    counterpartName,
    counterpartEmail,
    counterpartRole,
    weekStartedAt,
    weekCountTarget,
  } = input;
  if (!campaignId) return { ok: false, error: "campaignId required" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Normalise empties to null — "" shouldn't land in the DB as an empty
  // string (makes the UI's "not set" logic noisier later).
  const blankToNull = (s: string | null): string | null => {
    if (s === null) return null;
    const t = s.trim();
    return t === "" ? null : t;
  };

  const patch: Record<string, unknown> = {
    counterpart_name: blankToNull(counterpartName),
    counterpart_email: blankToNull(counterpartEmail),
    counterpart_role: blankToNull(counterpartRole),
    week_started_at: blankToNull(weekStartedAt),
    week_count_target:
      weekCountTarget === null || Number.isNaN(weekCountTarget)
        ? null
        : weekCountTarget,
  };

  const { error, count } = await supabase
    .from("campaigns")
    .update(patch, { count: "exact" })
    .eq("id", campaignId);

  if (error) {
    return { ok: false, error: error.message };
  }
  if (count === 0) {
    return {
      ok: false,
      error:
        "Update blocked — RLS only lets founders edit campaign metadata. If that's you, check `platform_founders`.",
    };
  }

  // Refresh every authed page that reads campaign metadata.
  revalidatePath("/home");
  revalidatePath("/tracker");
  revalidatePath("/approval");
  revalidatePath("/weekly");
  revalidatePath("/drafts");
  revalidatePath("/templates");
  return { ok: true };
}
