"use server";

import { revalidatePath } from "next/cache";
import { callOpenRouter } from "@/lib/openrouter";
import { createServerClient } from "@/lib/supabase/server";
import { getInvestorModalData } from "@/lib/queries/investorModal";
import { composeDraft } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/compose";
import { STATUS_BY_CODE } from "@/lib/status-codes";

/**
 * Server actions for the /send/[campaignId] linear flow.
 *
 * Each action maps to one user commit in the 9-step flow:
 *   saveBrief          — Step 1 persist
 *   saveCriteria       — Step 2 persist
 *   saveTemplate       — Step 6 persist
 *   setPartnerEmail    — Step 5 manual email entry (Hunter is the other path)
 *   draftSelected      — Step 7 batch-draft via compose + Opus refine
 *   approveBatch       — Step 8 promote selected partners to +1
 *   queueBatch         — Step 9 push approved rows into scheduled_sends
 */

async function assertAuthed() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user };
}

/* ───────────────────────── Step 1 / 2 / 6 — text fields ───────────────────── */

export async function saveBrief(
  campaignId: string,
  brief: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await assertAuthed();
  const { error } = await supabase
    .from("campaigns")
    .update({ company_description: brief })
    .eq("id", campaignId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/send/${campaignId}`);
  return { ok: true };
}

export async function saveCriteria(
  campaignId: string,
  criteria: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await assertAuthed();
  const { error } = await supabase
    .from("campaigns")
    .update({ hunting_criteria: criteria })
    .eq("id", campaignId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/send/${campaignId}`);
  return { ok: true };
}

export async function saveTemplate(
  campaignId: string,
  template: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await assertAuthed();
  const { error } = await supabase
    .from("campaigns")
    .update({ customer_template: template })
    .eq("id", campaignId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/send/${campaignId}`);
  return { ok: true };
}

/* ───────────────────────── Step 5 — email resolution (manual) ─────────────── */

/**
 * Write a manually-entered email for a partner. Uses the
 * partner_email_overrides table (migration 013) so the raw
 * partners_mirror row isn't mutated — the override layer is what
 * the rest of the app already respects for investor rows.
 */
export async function setPartnerEmail(
  partnerId: number,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await assertAuthed();
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  const { error } = await supabase
    .from("partner_email_overrides")
    .upsert(
      {
        partner_id: partnerId,
        email: trimmed,
        email_tier: "founder_entered",
        created_by: user.id,
      },
      { onConflict: "partner_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ───────────────────────── Step 7 pre-flight — who has an email? ─────────── */

/**
 * Returns the subset of campaign_partner ids that have a usable email
 * on file — either on partners_mirror.email or an override in
 * partner_email_overrides. Used by Step 7 to filter ticked rows down
 * to "worth drafting" before firing Opus. Tristan 2026-04-24: "I
 * don't want to draft all of them; I want to draft the ones which I
 * got emails for." Saves Opus tokens + user time.
 */
export async function getEmailedCampaignPartnerIds(
  campaignPartnerIds: string[],
): Promise<{ ok: true; emailed: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(campaignPartnerIds) || campaignPartnerIds.length === 0) {
    return { ok: true, emailed: [] };
  }
  const { supabase } = await assertAuthed();

  // Pull the campaign_partner → partner mirror join, plus any
  // overrides. A row is "emailed" if either the mirror or the
  // override carries a non-blank email.
  const { data: cps, error: cpErr } = await supabase
    .from("campaign_partners")
    .select(
      `
      id, partner_id,
      partners_mirror:partner_id ( id, email )
      `,
    )
    .in("id", campaignPartnerIds);
  if (cpErr) return { ok: false, error: cpErr.message };
  const rows = (cps ?? []) as unknown as Array<{
    id: string;
    partner_id: number | null;
    partners_mirror: { id: number; email: string | null } | null;
  }>;
  const partnerIds = rows
    .map((r) => r.partners_mirror?.id)
    .filter((id): id is number => typeof id === "number");

  const overrideByPartner = new Map<number, string>();
  if (partnerIds.length > 0) {
    const { data: overrides } = await supabase
      .from("partner_email_overrides")
      .select("partner_id, email")
      .in("partner_id", partnerIds);
    for (const row of (overrides ?? []) as Array<{
      partner_id: number;
      email: string | null;
    }>) {
      if (row.email && row.email.trim().length > 0) {
        overrideByPartner.set(row.partner_id, row.email.trim());
      }
    }
  }

  const emailed: string[] = [];
  for (const r of rows) {
    const partnerId = r.partners_mirror?.id;
    const mirrorEmail = r.partners_mirror?.email;
    const override = partnerId != null ? overrideByPartner.get(partnerId) : null;
    const eff = override ?? (mirrorEmail?.trim() ? mirrorEmail.trim() : null);
    if (eff && eff.length > 0) emailed.push(r.id);
  }
  return { ok: true, emailed };
}

/* ───────────────────────── Step 7 — batch-draft via Opus ──────────────────── */

/**
 * Produce (or refresh) rendered_synthesis + subject_angle for the
 * selected campaign_partner rows. The composer re-reads these on
 * the draft page so subsequent renders are fast. Runs serially to
 * keep rate-limit pressure low — batches of ~10 are fine, bigger
 * batches will run for tens of seconds but that's acceptable on the
 * initial "draft everything" click.
 */
export async function draftSelected(
  campaignPartnerIds: string[],
): Promise<
  | { ok: true; drafted: number; failed: Array<{ id: string; error: string }> }
  | { ok: false; error: string }
> {
  await assertAuthed();
  if (!Array.isArray(campaignPartnerIds) || campaignPartnerIds.length === 0) {
    return { ok: false, error: "No rows selected." };
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return { ok: false, error: "OPENROUTER_API_KEY missing in env." };
  }

  const supabase = await createServerClient();
  let drafted = 0;
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of campaignPartnerIds) {
    try {
      const data = await getInvestorModalData(id);
      if (!data) {
        failed.push({ id, error: "modal data not found" });
        continue;
      }
      // Ask Opus for a one-paragraph "why them" tailored to this
      // customer, using the campaign's customer_template + the
      // customer's pitch_hook / bio as inputs. We only cache the
      // synthesis + subject_angle here; the final body assembly
      // happens at render time via composeDraft.
      const firm = data.investor.firm_name ?? "this firm";
      const pitchHook = data.investor.thesis_summary ?? "";
      const firmBio = data.investor.thesis_deep ?? "";
      const geo = data.investor.geo_focus ?? "";
      const channel = data.investor.sector_focus ?? "";
      const brief = data.campaign?.company_description ?? "";
      const template = (data.campaign?.voice_reference_email ?? "") + "\n\n";

      const whyThem = await callOpenRouter({
        model: "openai/gpt-4.1",
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content: `You are drafting the "why them" paragraph for a first-touch customer outreach email. The paragraph is ONE paragraph, 3-5 sentences, written in the first person by Tristan Fischer (founder, Fischer Farms). It goes BETWEEN the economics paragraph and the meeting ask — it is the part that explains why THIS specific customer is a good fit, drawing on their channel, geography, regulatory exposure, and any public commitments. British spelling. No bracketed placeholders. Do NOT include the salutation, subject, or sign-off — just the one paragraph.`,
          },
          {
            role: "user",
            content: `Our product brief (what we sell): ${brief}\n\nThe customer: ${firm}\nChannel: ${channel}\nGeography: ${geo}\nOne-line pitch hook (briefing view): ${pitchHook}\nBio: ${firmBio}\n\nWrite the "why them" paragraph for a cold outreach email to a plant-category buyer at ${firm}.`,
          },
        ],
      });

      // Also ask for a 2-5 word subject angle.
      const subjectAngle = (await callOpenRouter({
        model: "openai/gpt-4.1",
        max_tokens: 60,
        messages: [
          {
            role: "system",
            content:
              "Return a 2-5 word subject-line angle specific to this customer. No quotes, no ending punctuation. Examples: 'Swedish-sited container', 'Quebec hydro 2.9p/kWh', 'EU 2026 residue shield'. Just the phrase.",
          },
          {
            role: "user",
            content: `Customer: ${firm} | Channel: ${channel} | Geography: ${geo} | Pitch hook: ${pitchHook}. Give me a 2-5 word subject angle.`,
          },
        ],
      }))
        .replace(/^["'"]+|["'"]+$/g, "")
        .slice(0, 80);

      const { error: updateErr } = await supabase
        .from("campaign_partners")
        .update({
          rendered_synthesis: whyThem,
          rendered_synthesis_at: new Date().toISOString(),
          subject_angle: subjectAngle,
          // Promote to +2 Drafted — ready to send so Step 8 can pick
          // these up. If approval flips them to -3 later, the
          // status_code moves.
          status_code: "+2",
          status_label: "Drafted — ready to send",
        })
        .eq("id", id);
      if (updateErr) {
        failed.push({ id, error: updateErr.message });
        continue;
      }
      drafted += 1;
    } catch (err) {
      failed.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  revalidatePath(`/send/${campaignPartnerIds[0] ? "" : ""}`);
  return { ok: true, drafted, failed };
}

/* ───────────────────────── Step 8 — approve batch ─────────────────────────── */

export async function approveBatch(
  campaignPartnerIds: string[],
): Promise<
  | { ok: true; approved: number; failed: Array<{ id: string; error: string }> }
  | { ok: false; error: string }
> {
  const { supabase } = await assertAuthed();
  if (!Array.isArray(campaignPartnerIds) || campaignPartnerIds.length === 0) {
    return { ok: false, error: "No rows selected." };
  }
  // Sanity: every code we write must be in STATUS_CODES. Protects
  // against the ghost-code class of bug (cf. 2026-04-23 +6.5 leak).
  if (!STATUS_BY_CODE["+1"]) {
    return { ok: false, error: "+1 not in STATUS_CODES — migration drift." };
  }

  const { error } = await supabase
    .from("campaign_partners")
    .update({
      status_code: "+1",
      status_label: STATUS_BY_CODE["+1"].label,
    })
    .in("id", campaignPartnerIds);
  if (error) return { ok: false, error: error.message };

  const { count } = await supabase
    .from("campaign_partners")
    .select("id", { count: "exact", head: true })
    .in("id", campaignPartnerIds);

  return { ok: true, approved: count ?? 0, failed: [] };
}

/* ───────────────────────── Step 9 — queue into scheduled_sends ────────────── */

/**
 * Queue the selected APPROVED rows for scheduled dispatch. The
 * DB-level approval gate (migration 029) enforces status_code IN
 * ('+1', '+2') — any non-approved row raises P0001 here.
 *
 * Scheduling model: rows land with a random jitter inside a 60-minute
 * window starting at the given sendAtUtc. That mimics the
 * queueScheduledBatch investor-flow behaviour without the local-
 * timezone-per-partner complexity (we don't have tz data for
 * customer rows yet).
 */
export async function queueBatch(
  campaignPartnerIds: string[],
  sendAtUtc: string,
): Promise<
  | { ok: true; queued: number; failed: Array<{ id: string; error: string }> }
  | { ok: false; error: string }
> {
  const { supabase, user } = await assertAuthed();
  if (!Array.isArray(campaignPartnerIds) || campaignPartnerIds.length === 0) {
    return { ok: false, error: "No rows selected." };
  }
  const baseTime = Date.parse(sendAtUtc);
  if (Number.isNaN(baseTime)) {
    return { ok: false, error: "Invalid sendAtUtc timestamp." };
  }

  let queued = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of campaignPartnerIds) {
    try {
      const data = await getInvestorModalData(id);
      if (!data) {
        failed.push({ id, error: "modal data not found" });
        continue;
      }
      const email = data.primary_partner?.email;
      if (!email) {
        failed.push({ id, error: "no email on primary contact" });
        continue;
      }
      const draft = composeDraft(data);
      const subject = draft.subject.slice(0, 240);
      const body = draft.fullBody;

      // Spread sends over 60 minutes.
      const jitterMinutes = Math.floor(Math.random() * 60);
      const scheduledForUtc = new Date(
        baseTime + jitterMinutes * 60 * 1000,
      ).toISOString();

      const { error: insertErr } = await supabase
        .from("scheduled_sends")
        .insert({
          campaign_partner_id: id,
          to_email: email,
          subject,
          body,
          scheduled_for_utc: scheduledForUtc,
          status: "pending",
          created_by: user.id,
        });
      if (insertErr) {
        // DB approval gate throws P0001 on unapproved rows; surface
        // that message verbatim so the UI can explain.
        failed.push({ id, error: insertErr.message });
        continue;
      }
      queued += 1;
    } catch (err) {
      failed.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, queued, failed };
}
