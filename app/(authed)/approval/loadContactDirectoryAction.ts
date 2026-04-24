"use server";

import {
  getContactDirectoryForCampaignPartner,
  type ContactDirectory,
} from "@/lib/queries/contacts";

/**
 * Server-action wrapper around getContactDirectoryForCampaignPartner
 * so the ContactPicker client component can lazy-load on open.
 *
 * We don't pre-fetch on every /approval row render — a firm with 150+
 * contacts (max in DB 2026-04-24) × 50 rows on the approval sheet
 * would mean ~7,500 extra partner row fetches per page paint. Lazy
 * load keeps the first paint cheap; the fetch only fires the first
 * time Tristan opens the picker on a given row.
 */
export async function loadContactDirectory(
  campaignPartnerId: string,
): Promise<ContactDirectory | null> {
  return getContactDirectoryForCampaignPartner(campaignPartnerId);
}
