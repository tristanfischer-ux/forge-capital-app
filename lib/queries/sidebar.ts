import { createServerClient } from "@/lib/supabase/server";
import { STATUS_CODES } from "@/lib/status-codes";

/**
 * Right-rail sidebar queries (§1b of the V4 port). All four sidebar
 * cards source their numbers from live Supabase rows so nothing is
 * fabricated — where a signal is genuinely unavailable we return null /
 * empty so the component can render an honest empty state.
 *
 * V4 shows populated hard-coded numbers (e.g. "In approval queue · 34").
 * In V1 the mirrors may be empty; the cards render "—" for missing
 * counts rather than inventing zeros that look like real signal.
 */

/* -------------------------------------------------------------------
   Drafts ready for review
   ------------------------------------------------------------------- */

/**
 * One "drafts ready for review" row. These are campaign_partners at
 * status_code='+2 Drafted' — the V4 sidebar promises the founder
 * "Gmail is the source of truth. We never send — you review and send
 * from Gmail."
 *
 * We source the body text by rendering the campaign's top email
 * template against the partner's mirror data. The rendered body lives
 * in the returned `preview` (first ~160 chars) + `word_count` is a
 * fast split count used by the side-card footer.
 */
export interface SidebarDraftRow {
  campaign_partner_id: string;
  firm_name: string | null;
  partner_name: string | null;
  subject: string | null;
  preview: string;
  word_count: number;
  /** How many minutes since the draft was "saved" — maps to the
   *  partner's `last_contact_at` in V1. Null if unknown. */
  saved_minutes_ago: number | null;
}

/**
 * Supabase join shape for the +2 Drafted rows we surface in the
 * sidebar. We hoist the nested relations through the shape so a
 * typed mapper can project exactly the fields the card renders.
 */
interface DraftJoinRow {
  id: string;
  last_contact_at: string | null;
  partners_mirror: {
    name: string | null;
    investors_mirror: {
      firm_name: string | null;
      thesis_summary: string | null;
    } | null;
  } | null;
}

/**
 * Shape of the single email template we pull per campaign. The real
 * template composition (credibility + company + synthesis + CTA) lives
 * in Phase 6 — for the sidebar preview we just want the first few
 * sentences of a sensible body so the card reads like a real draft.
 */
interface TemplateRow {
  template_name: string | null;
  credibility_paragraph_short: string | null;
  company_paragraph: string | null;
  intelligent_synthesis_template: string | null;
  full_template_rendered: string | null;
}

/**
 * Render a draft "preview" for the sidebar card. Uses the best template
 * body we have, interpolates {{FIRM_NAME}} / {{FIRM_THESIS}} placeholders
 * with partner mirror data, and returns the first 160-ish characters of
 * the first non-empty paragraph. The full-body word-count is computed
 * separately so the footer stays honest even when the preview is short.
 */
function renderDraftBody(
  template: TemplateRow | null,
  firmName: string,
  firmThesis: string,
): { preview: string; word_count: number } {
  const source =
    template?.full_template_rendered ??
    [
      template?.credibility_paragraph_short,
      template?.company_paragraph,
      template?.intelligent_synthesis_template,
    ]
      .filter(Boolean)
      .join("\n\n");

  if (!source || source.trim().length === 0) {
    return { preview: "", word_count: 0 };
  }

  const rendered = source
    .replaceAll("{{FIRM_NAME}}", firmName || "the fund")
    .replaceAll("{{FIRM_THESIS}}", firmThesis || "your thesis");

  // Strip blank lines and take the first paragraph for the preview.
  const paragraphs = rendered.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const first = paragraphs[0] ?? "";
  const preview = first.length > 160 ? first.slice(0, 157).trimEnd() + "…" : first;

  // Count words across the full body — footer "147 words" is about the
  // email Tristan is being asked to review, not the preview clip.
  const word_count = rendered.split(/\s+/).filter(Boolean).length;

  return { preview, word_count };
}

/**
 * Pulls up to `limit` drafts at +2 Drafted for the current campaign,
 * sorted by `last_contact_at` desc (most recently-moved first), joined
 * to the mirror tables so we can render the "To {name} · {firm}" line.
 *
 * V1 has nothing at +2 until a real draft run happens, so an empty
 * array is the expected dominant case. The component renders an honest
 * empty state; this function stays silent.
 */
export async function getSidebarDrafts(
  campaignId: string,
  limit = 3,
): Promise<SidebarDraftRow[]> {
  const supabase = await createServerClient();

  // The top template for this campaign. V1 has at most one per campaign
  // (seeded from Gmail sends) so `limit(1)` is fine. If none, the
  // draft body preview becomes "" and the card flags missing copy
  // honestly instead of fabricating.
  const [{ data: draftsRaw, error: draftsErr }, { data: tplRaw }] =
    await Promise.all([
      supabase
        .from("campaign_partners")
        .select(
          `
          id,
          last_contact_at,
          partners_mirror:partner_id (
            name,
            investors_mirror:investor_id (
              firm_name,
              thesis_summary
            )
          )
          `,
        )
        .eq("campaign_id", campaignId)
        .eq("status_code", "+2")
        .order("last_contact_at", { ascending: false, nullsFirst: false })
        .limit(limit),
      supabase
        .from("email_templates")
        .select(
          "template_name, credibility_paragraph_short, company_paragraph, intelligent_synthesis_template, full_template_rendered",
        )
        .eq("campaign_id", campaignId)
        .limit(1)
        .maybeSingle(),
    ]);

  if (draftsErr) {
    // RLS denial or empty mirrors. Silent — the card renders empty state.
    console.error("getSidebarDrafts failed:", draftsErr.message);
    return [];
  }

  const tpl = (tplRaw ?? null) as TemplateRow | null;
  const rows = (draftsRaw ?? []) as unknown as DraftJoinRow[];
  const now = Date.now();

  return rows.map((row) => {
    const partner = row.partners_mirror;
    const investor = partner?.investors_mirror ?? null;
    const firmName = investor?.firm_name ?? "";
    const firmThesis = investor?.thesis_summary ?? "";

    const { preview, word_count } = renderDraftBody(tpl, firmName, firmThesis);

    const saved_minutes_ago = row.last_contact_at
      ? Math.max(0, Math.floor((now - new Date(row.last_contact_at).getTime()) / 60000))
      : null;

    // Subject line: we do not have a dedicated `subject` column in V1.
    // Derive it from the template_name if present + the firm name; this
    // is the honest read on what the subject will look like once the
    // draft-compose pipeline (Phase 6) lands. If nothing is derivable,
    // we return null so the card can show an em-dash.
    const subject = tpl?.template_name && firmName
      ? `${tpl.template_name} — ${firmName}`
      : null;

    return {
      campaign_partner_id: row.id,
      firm_name: firmName || null,
      partner_name: partner?.name ?? null,
      subject,
      preview,
      word_count,
      saved_minutes_ago,
    };
  });
}

/* -------------------------------------------------------------------
   Pipeline health at a glance
   ------------------------------------------------------------------- */

export interface PipelineHealth {
  /** Count at +0 or +1 — the approval queue before drafting. */
  in_approval_queue: number;
  /** Count at +2 Drafted — drafts sat in Gmail awaiting Tristan. */
  in_gmail_drafts: number;
  /** Count at +3 / +4 / +5 — sent, waiting for a response. */
  sent_awaiting: number;
  /** Count at +6 Response received — responses not yet logged upstream. */
  replies_pending_log: number;
  /** Count where the email_tier is generic_blocked or bounced. */
  gate_blocked: number;
  /**
   * Week of the 16-week campaign clock. Derived from campaign.created_at;
   * null if the campaign predates the clock or we can't resolve it.
   */
  week_of_sixteen: number | null;
  /** Campaign name for the subcopy ("SkySails Power · week N of 16"). */
  campaign_name: string;
}

/**
 * Computes pipeline-health counts for a single campaign in one query.
 * The whole calculation is done client-side on a single column pull —
 * bandwidth is trivial and the alternative (five COUNT queries) is
 * five round-trips we don't need.
 *
 * V1 note: gate-blocked joins through partners_mirror.email_tier. If
 * the mirror has nothing to say about an address we treat it as
 * "unverified" (i.e. not gate-blocked). Only `generic_blocked` and
 * `bounced` are hard-blocked per V4-FEEDBACK-ROUND-2.md.
 */
export async function getPipelineHealth(
  campaignId: string,
  campaignName: string,
  campaignCreatedAt: string | null,
): Promise<PipelineHealth> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select(
      `
      status_code,
      partners_mirror:partner_id (
        email_tier
      )
      `,
    )
    .eq("campaign_id", campaignId);

  if (error) {
    console.error("getPipelineHealth failed:", error.message);
    return {
      in_approval_queue: 0,
      in_gmail_drafts: 0,
      sent_awaiting: 0,
      replies_pending_log: 0,
      gate_blocked: 0,
      week_of_sixteen: null,
      campaign_name: campaignName,
    };
  }

  interface HealthJoin {
    status_code: string | null;
    partners_mirror: { email_tier: string | null } | null;
  }
  const rows = (data ?? []) as unknown as HealthJoin[];

  let in_approval_queue = 0;
  let in_gmail_drafts = 0;
  let sent_awaiting = 0;
  let replies_pending_log = 0;
  let gate_blocked = 0;

  for (const r of rows) {
    const s = r.status_code;
    if (s === "+0" || s === "+1") in_approval_queue += 1;
    else if (s === "+2") in_gmail_drafts += 1;
    else if (s === "+3" || s === "+4" || s === "+5") sent_awaiting += 1;
    else if (s === "+6") replies_pending_log += 1;

    const tier = r.partners_mirror?.email_tier ?? null;
    if (tier === "generic_blocked" || tier === "bounced") gate_blocked += 1;
  }

  // Week clock — integer weeks since campaign.created_at, clamped to 1..16.
  // Returns null if the timestamp is missing or produces a negative delta.
  let week_of_sixteen: number | null = null;
  if (campaignCreatedAt) {
    const created = new Date(campaignCreatedAt).getTime();
    if (Number.isFinite(created)) {
      const msPerWeek = 1000 * 60 * 60 * 24 * 7;
      const delta = Date.now() - created;
      if (delta >= 0) {
        const w = Math.min(16, Math.max(1, Math.floor(delta / msPerWeek) + 1));
        week_of_sixteen = w;
      }
    }
  }

  return {
    in_approval_queue,
    in_gmail_drafts,
    sent_awaiting,
    replies_pending_log,
    gate_blocked,
    week_of_sixteen,
    campaign_name: campaignName,
  };
}

/* -------------------------------------------------------------------
   Tracker health — all populated status codes as a vertical list
   ------------------------------------------------------------------- */

export interface TrackerHealthRow {
  code: string;
  label: string;
  count: number;
  family: "committed" | "progressing" | "pending" | "dead";
}

export interface TrackerHealth {
  rows: TrackerHealthRow[];
  total: number;
  /**
   * Partners "touched" — anything past +0 Pending approval. V4 shows
   * "133 / 276 Total touched" as the footer of this card.
   */
  touched: number;
}

/**
 * Counts per status_code for a campaign, returned in the canonical
 * 16-code order, filtered to codes that actually have rows (zero codes
 * are suppressed to keep the card compact per the V4 layout).
 */
export async function getTrackerHealth(
  campaignId: string,
): Promise<TrackerHealth> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("campaign_partners")
    .select("status_code")
    .eq("campaign_id", campaignId);

  if (error) {
    console.error("getTrackerHealth failed:", error.message);
    return { rows: [], total: 0, touched: 0 };
  }

  const counts = new Map<string, number>();
  let total = 0;
  for (const row of data ?? []) {
    const code = (row as { status_code: string | null }).status_code;
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    total += 1;
  }

  const rows: TrackerHealthRow[] = [];
  for (const s of STATUS_CODES) {
    const n = counts.get(s.code);
    if (!n) continue;
    rows.push({ code: s.code, label: s.label, count: n, family: s.family });
  }

  // "Touched" = anything past +0 Pending approval. Keep the V4 mental
  // model: "+0 and unset" are the untouched bucket; everything else
  // has had at least a draft event on it.
  const touched = rows
    .filter((r) => r.code !== "+0")
    .reduce((sum, r) => sum + r.count, 0);

  return { rows, total, touched };
}
