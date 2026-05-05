import { createServerClient } from "@/lib/supabase/server";
import { listActiveCampaigns } from "@/lib/queries/campaigns";

/**
 * Export investors needing client permission as a CSV (can be opened in Excel).
 * Returns a CSV string that the client can download.
 */
export async function exportPermissionList(campaignId: string): Promise<{ csv: string; filename: string; count: number } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Get campaign name
  const campaigns = await listActiveCampaigns();
  const campaign = campaigns.find((c) => c.id === campaignId);
  const campaignName = campaign?.name ?? "campaign";

  // Get investors needing permission — permission_status = 'pending_approval'
  // Note: if the column doesn't exist yet, this will return empty
  const { data: partners, error } = await supabase
    .from("campaign_partners")
    .select(`
      id,
      partner_id,
      status_code,
      status_label,
      partners_mirror!inner (
        id,
        name,
        title,
        email,
        investors_mirror!inner (
          firm_name,
          type,
          website,
          hq_location,
          thesis_summary,
          sector_focus
        )
      )
    `)
    .eq("campaign_id", campaignId)
    .eq("permission_status", "pending_approval");

  if (error) {
    // Column might not exist yet — return empty
    return { error: "permission_status column not yet added. Run the migration SQL in Supabase dashboard." };
  }

  if (!partners || partners.length === 0) {
    return { error: "No investors pending permission for this campaign." };
  }

  // Build CSV
  const headers = ["Investor", "Contact", "Title", "Email", "Type", "Website", "HQ", "Sector", "Thesis", "Current Status"];
  const rows = partners.map((p: any) => {
    const inv = p.partners_mirror?.investors_mirror;
    return [
      inv?.firm_name ?? "",
      p.partners_mirror?.name ?? "",
      p.partners_mirror?.title ?? "",
      p.partners_mirror?.email ?? "",
      inv?.type ?? "",
      inv?.website ?? "",
      inv?.hq_location ?? "",
      inv?.sector_focus ?? "",
      inv?.thesis_summary ?? "",
      p.status_label ?? p.status_code ?? "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
  });

  const csv = [headers.join(","), ...rows.map((r: string[]) => r.join(","))].join("\n");
  const filename = `${campaignName.replace(/[^a-zA-Z0-9]/g, "_")}_permission_request.csv`;

  return { csv, filename, count: partners.length };
}

/**
 * Update permission status for a list of campaign_partners rows.
 * Called after the client responds with yes/no.
 */
export async function updatePermissionStatus(
  campaignId: string,
  partnerIds: number[],
  status: "approved" | "denied"
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, updated: 0, error: "Not signed in" };

  const { data, error } = await supabase
    .from("campaign_partners")
    .update({ permission_status: status })
    .eq("campaign_id", campaignId)
    .in("partner_id", partnerIds)
    .eq("permission_status", "pending_approval")
    .select("id");

  if (error) {
    return { ok: false, updated: 0, error: error.message };
  }

  return { ok: true, updated: data?.length ?? 0 };
}

/**
 * Mark investors as needing permission (set permission_status to 'pending_approval').
 * Called when Tristan decides a campaign's investors need client approval before outreach.
 */
export async function markForPermission(
  campaignId: string,
  partnerIds: number[]
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, updated: 0, error: "Not signed in" };

  const { data, error } = await supabase
    .from("campaign_partners")
    .update({ permission_status: "pending_approval" })
    .eq("campaign_id", campaignId)
    .in("partner_id", partnerIds)
    .eq("permission_status", "not_required")
    .select("id");

  if (error) {
    return { ok: false, updated: 0, error: error.message };
  }

  return { ok: true, updated: data?.length ?? 0 };
}
