import { createServerClient } from "@/lib/supabase/server";

/**
 * The 5-tier deliverability taxonomy from `003_partners_mirror.sql`.
 * Only `corresponded` and `hunter_verified` can legitimately advance a
 * partner to +2 Drafted (per V4-FEEDBACK-ROUND-2.md §"Verification tiers").
 * `generic_blocked` and `bounced` must surface as RED badges with a
 * hunt-for-replacement CTA.
 */
export type EmailTier =
  | "corresponded"
  | "hunter_verified"
  | "unverified"
  | "generic_blocked"
  | "bounced"
  | null;

/**
 * A row in the tracker grid — the output of the campaign_partners +
 * partners_mirror + investors_mirror join. Fields we cannot derive from
 * current data resolve to null and render as an em-dash in the grid;
 * we never fabricate.
 */
export interface TrackerRow {
  id: string;
  status_code: string | null;
  status_label: string | null;
  email_tier: EmailTier;
  days_since_last_contact: number | null;
  firm_name: string | null;
  partner_name: string | null;
  partner_title: string | null;
  /** Two-sentence summary derived from `investors_mirror.thesis_summary`. */
  company_summary: string | null;
  /** Why-them synthesis pulled from `investors_mirror.synthesis_data` jsonb. */
  partner_why_them: string | null;
}

/**
 * Shape of the raw Supabase join result. Declared here so the mapper
 * can stay strictly typed without leaning on `any`.
 */
interface TrackerJoinRow {
  id: string;
  status_code: string | null;
  status_label: string | null;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    title: string | null;
    email_tier: string | null;
    investors_mirror: {
      firm_name: string | null;
      thesis_summary: string | null;
      synthesis_data: unknown;
    } | null;
  } | null;
}

/**
 * Derives a two-sentence company + investor context paragraph from the
 * investor's thesis_summary. Returns null if the source is empty. We
 * deliberately do not fabricate — if the mirror row has no summary,
 * the grid shows an em-dash.
 */
function deriveCompanySummary(thesisSummary: string | null): string | null {
  if (!thesisSummary) return null;
  const trimmed = thesisSummary.trim();
  if (trimmed.length === 0) return null;
  // Split on sentence boundaries, keep the first two. Preserves the
  // original wording from the pipeline — no rewriting.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return null;
  return sentences.slice(0, 2).join(" ");
}

/**
 * Pulls a why-them synthesis paragraph out of the investors_mirror
 * `synthesis_data` jsonb. The shape of that column is owned by the
 * Forge Capital pipeline (`research/17-unified-pipeline.py`) and the
 * relevant field names we know about are `why_them`, `connection`, and
 * `intelligent_synthesis`. Probe each in turn; if none match or the
 * jsonb is not an object, return null rather than inventing copy.
 */
function deriveWhyThem(synthesisData: unknown): string | null {
  if (!synthesisData || typeof synthesisData !== "object") return null;
  const rec = synthesisData as Record<string, unknown>;
  const candidateKeys = ["why_them", "connection", "intelligent_synthesis"];
  for (const key of candidateKeys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Fetches tracker rows for a given campaign. Read-only — V1 does not
 * support in-page status edits (that lands in Phase 5).
 *
 * The mirrors (`partners_mirror`, `investors_mirror`) are populated by
 * the nightly sync; until that has run for the first time the result
 * will be empty and the tracker page renders its honest empty state.
 */
export async function getTrackerRows(
  campaignId: string,
): Promise<TrackerRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      id,
      status_code,
      status_label,
      last_contact_at,
      partners_mirror:partner_id (
        name,
        title,
        email_tier,
        investors_mirror:investor_id (
          firm_name,
          thesis_summary,
          synthesis_data
        )
      )
      `,
    )
    .eq("campaign_id", campaignId);

  if (error) {
    // Server component will render the empty-state copy; an error here
    // generally means RLS denied access (unauthenticated request) or
    // the mirror tables have not been populated yet.
    console.error("getTrackerRows failed:", error.message);
    return [];
  }

  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;

  // Supabase's generated types model embedded relations as arrays even
  // for to-one relations, so we normalise via an intermediate cast.
  const rows = (data ?? []) as unknown as TrackerJoinRow[];

  return rows.map((row) => {
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;

    const daysSince = row.last_contact_at
      ? Math.max(
          0,
          Math.floor((now - new Date(row.last_contact_at).getTime()) / msPerDay),
        )
      : null;

    return {
      id: row.id,
      status_code: row.status_code,
      status_label: row.status_label,
      email_tier: (partner?.email_tier ?? null) as EmailTier,
      days_since_last_contact: daysSince,
      firm_name: investor?.firm_name ?? null,
      partner_name: partner?.name ?? null,
      partner_title: partner?.title ?? null,
      company_summary: deriveCompanySummary(investor?.thesis_summary ?? null),
      partner_why_them: deriveWhyThem(investor?.synthesis_data),
    };
  });
}
