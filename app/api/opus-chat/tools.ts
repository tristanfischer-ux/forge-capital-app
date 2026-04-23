import type { SupabaseClient } from "@supabase/supabase-js";
import { logInteraction } from "@/app/(authed)/partner/[id]/logInteractionAction";
import { refineSynthesisWithOpus } from "@/app/(authed)/tracker/[campaignPartnerId]/draft/refineSynthesisAction";

/**
 * Tool definitions + dispatcher for the in-app Opus 4.7 chat.
 *
 * V2 upgrade — Tristan dictates things like "log a 30-min call with
 * Astasia Myers just now" and the chat resolves the name, logs the
 * interaction, and optionally runs synthesis. Each tool is a thin
 * wrapper over an existing server action — this file does NOT
 * introduce new server-side behaviour.
 *
 * Safety: log_interaction REQUIRES a partner_id that came from
 * search_partners. Opus is system-prompted never to invent ids — if
 * it does, the DB write fails cleanly because the partner row won't
 * exist.
 */

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const CHAT_TOOLS: AnthropicToolDef[] = [
  {
    name: "search_partners",
    description:
      "Fuzzy-search partners by name or firm name. Returns up to 5 matches with id, contact name, firm name, and email. ALWAYS call this before log_interaction or resolve_campaign_partner — never invent a partner_id.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text query — matches against partners_mirror.name and investors_mirror.firm_name with case-insensitive prefix/substring. E.g. 'Astasia Myers' or 'Quiet Capital'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "resolve_campaign_partner",
    description:
      "Given a partner_id, return the most recent campaign_partners row for that partner (the one the weekly tracker / approval queue would surface). Needed before refine_synthesis when the user gives only a partner name.",
    input_schema: {
      type: "object",
      properties: {
        partner_id: {
          type: "integer",
          description:
            "partners_mirror.id — the bare numeric id returned by search_partners.",
        },
      },
      required: ["partner_id"],
    },
  },
  {
    name: "log_interaction",
    description:
      "Log a call, meeting, LinkedIn message, WhatsApp, note, or intel item against a partner. Writes to contact_events, bumps last_contact_at on campaign_partners, and optionally runs Opus synthesis over the notes. Call search_partners FIRST to resolve the partner_id — never guess.",
    input_schema: {
      type: "object",
      properties: {
        partner_id: {
          type: "integer",
          description: "partners_mirror.id from search_partners.",
        },
        event_type: {
          type: "string",
          enum: [
            "call",
            "meeting",
            "linkedin_message",
            "linkedin_connect",
            "whatsapp",
            "slack",
            "personal_note",
            "handover_note",
            "intel",
          ],
          description:
            "Use 'call' for any voice conversation (phone / Zoom / Meet). 'meeting' for in-person.",
        },
        notes: {
          type: "string",
          description:
            "Call transcript, meeting notes, or the note body. If this looks like a Wispr voice-to-text paste, pass it verbatim and set run_synthesis=true.",
        },
        duration_minutes: {
          type: "integer",
          description:
            "Call / meeting duration in minutes. Omit for notes and messages.",
        },
        title: {
          type: "string",
          description:
            "Short label for the interaction, e.g. '30-min intro call'. Optional.",
        },
        follow_up_due_at: {
          type: "string",
          description:
            "ISO 8601 datetime when Tristan owes a follow-up. Omit if none.",
        },
        event_at: {
          type: "string",
          description:
            "ISO 8601 datetime the interaction happened. Defaults to now if omitted.",
        },
        run_synthesis: {
          type: "boolean",
          description:
            "If true and notes are >=120 chars, runs Opus synthesis (summary, action items, intel, quotes, suggested status). Default true for calls and meetings.",
        },
      },
      required: ["partner_id", "event_type"],
    },
  },
  {
    name: "refine_synthesis",
    description:
      "Re-generate the per-investor synthesis paragraph and subject-line angle for a campaign_partners row, using Opus 4.7 with full firm + thesis context. Writes back to campaign_partners.rendered_synthesis / subject_angle. Use when the user says 'refine synthesis for X' or 'regenerate the synthesis for partner Y'.",
    input_schema: {
      type: "object",
      properties: {
        campaign_partner_id: {
          type: "string",
          description:
            "campaign_partners.id (uuid). If the user gives only a partner name, call search_partners then resolve_campaign_partner first.",
        },
      },
      required: ["campaign_partner_id"],
    },
  },
];

export interface ToolInvocationContext {
  supabase: SupabaseClient;
}

export interface ToolExecutionResult {
  /** Short human-readable summary shown inline in the chat as a chip. */
  summary: string;
  /** Structured payload fed back to Opus as the tool_result content. */
  data: unknown;
  /** If true, render the chip in an error style. */
  isError?: boolean;
}

export async function dispatchTool(
  name: string,
  input: unknown,
  ctx: ToolInvocationContext,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case "search_partners":
        return await runSearchPartners(input, ctx);
      case "resolve_campaign_partner":
        return await runResolveCampaignPartner(input, ctx);
      case "log_interaction":
        return await runLogInteraction(input);
      case "refine_synthesis":
        return await runRefineSynthesis(input);
      default:
        return {
          summary: `Unknown tool: ${name}`,
          data: { error: `Unknown tool: ${name}` },
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      summary: `${name} crashed: ${msg}`,
      data: { error: msg },
      isError: true,
    };
  }
}

/* ------------------------ individual tools ------------------------ */

interface SearchPartnersInput {
  query?: unknown;
}

async function runSearchPartners(
  input: unknown,
  ctx: ToolInvocationContext,
): Promise<ToolExecutionResult> {
  const { query } = (input ?? {}) as SearchPartnersInput;
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) {
    return {
      summary: "search_partners: empty query",
      data: { error: "query is required" },
      isError: true,
    };
  }
  // Escape postgrest special chars in ilike patterns.
  const safe = q.replace(/[%_,()]/g, " ").trim();
  const pattern = `%${safe}%`;

  // Match on partner name OR investor firm_name (via embedded join).
  const { supabase } = ctx;
  const [{ data: byName }, { data: byFirm }] = await Promise.all([
    supabase
      .from("partners_mirror")
      .select(
        `id, name, email,
         investors_mirror:investor_id (firm_name)`,
      )
      .ilike("name", pattern)
      .limit(5),
    supabase
      .from("investors_mirror")
      .select(
        `id, firm_name,
         partners_mirror!inner (id, name, email, is_primary_contact)`,
      )
      .ilike("firm_name", pattern)
      .limit(3),
  ]);

  const results: Array<{
    partner_id: number;
    name: string | null;
    firm_name: string | null;
    email: string | null;
  }> = [];

  for (const row of (byName ?? []) as unknown as Array<{
    id: number;
    name: string | null;
    email: string | null;
    investors_mirror: { firm_name: string | null } | null;
  }>) {
    results.push({
      partner_id: row.id,
      name: row.name,
      firm_name: row.investors_mirror?.firm_name ?? null,
      email: row.email,
    });
  }

  for (const firm of (byFirm ?? []) as unknown as Array<{
    id: number;
    firm_name: string | null;
    partners_mirror: Array<{
      id: number;
      name: string | null;
      email: string | null;
      is_primary_contact: boolean | null;
    }>;
  }>) {
    // Prefer the primary contact when a firm hits.
    const partners = [...(firm.partners_mirror ?? [])].sort(
      (a, b) =>
        (b.is_primary_contact ? 1 : 0) - (a.is_primary_contact ? 1 : 0),
    );
    for (const p of partners.slice(0, 2)) {
      if (results.some((r) => r.partner_id === p.id)) continue;
      results.push({
        partner_id: p.id,
        name: p.name,
        firm_name: firm.firm_name,
        email: p.email,
      });
    }
  }

  const top5 = results.slice(0, 5);
  return {
    summary: `search_partners("${q}") → ${top5.length} match${top5.length === 1 ? "" : "es"}`,
    data: { query: q, matches: top5 },
  };
}

interface ResolveCampaignPartnerInput {
  partner_id?: unknown;
}

async function runResolveCampaignPartner(
  input: unknown,
  ctx: ToolInvocationContext,
): Promise<ToolExecutionResult> {
  const { partner_id } = (input ?? {}) as ResolveCampaignPartnerInput;
  const pid =
    typeof partner_id === "number"
      ? partner_id
      : typeof partner_id === "string"
        ? Number.parseInt(partner_id, 10)
        : NaN;
  if (!Number.isFinite(pid)) {
    return {
      summary: "resolve_campaign_partner: invalid partner_id",
      data: { error: "partner_id must be an integer" },
      isError: true,
    };
  }

  const { data } = await ctx.supabase
    .from("campaign_partners")
    .select(
      `id, campaign_id, status_code, status_label, created_at,
       campaigns ( name, campaign_intent )`,
    )
    .eq("partner_id", pid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      summary: `resolve_campaign_partner(${pid}) → no campaign`,
      data: {
        error: `No campaign_partners row for partner ${pid}. They need to be added to a campaign first.`,
      },
      isError: true,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  return {
    summary: `resolve_campaign_partner(${pid}) → ${row.campaigns?.name ?? "campaign"} · ${row.status_code ?? "?"}`,
    data: {
      campaign_partner_id: row.id as string,
      campaign_name: row.campaigns?.name ?? null,
      campaign_intent: row.campaigns?.campaign_intent ?? null,
      status_code: row.status_code ?? null,
      status_label: row.status_label ?? null,
    },
  };
}

interface LogInteractionToolInput {
  partner_id?: unknown;
  event_type?: unknown;
  notes?: unknown;
  duration_minutes?: unknown;
  title?: unknown;
  follow_up_due_at?: unknown;
  event_at?: unknown;
  run_synthesis?: unknown;
}

async function runLogInteraction(
  input: unknown,
): Promise<ToolExecutionResult> {
  const i = (input ?? {}) as LogInteractionToolInput;
  const partnerId =
    typeof i.partner_id === "number"
      ? i.partner_id
      : typeof i.partner_id === "string"
        ? Number.parseInt(i.partner_id, 10)
        : NaN;
  if (!Number.isFinite(partnerId)) {
    return {
      summary: "log_interaction: partner_id missing or invalid",
      data: {
        error:
          "partner_id must be a number. Call search_partners first and pass the partner_id from the result.",
      },
      isError: true,
    };
  }
  const eventType = typeof i.event_type === "string" ? i.event_type : "";
  const allowedTypes = [
    "call",
    "meeting",
    "linkedin_message",
    "linkedin_connect",
    "whatsapp",
    "slack",
    "personal_note",
    "handover_note",
    "intel",
  ];
  if (!allowedTypes.includes(eventType)) {
    return {
      summary: `log_interaction: invalid event_type '${eventType}'`,
      data: { error: `event_type must be one of ${allowedTypes.join(", ")}` },
      isError: true,
    };
  }

  const now = new Date().toISOString();
  const eventAt = typeof i.event_at === "string" && i.event_at ? i.event_at : now;
  const notes = typeof i.notes === "string" ? i.notes : undefined;
  const title = typeof i.title === "string" ? i.title : undefined;
  const followUp =
    typeof i.follow_up_due_at === "string" && i.follow_up_due_at
      ? i.follow_up_due_at
      : undefined;
  const duration =
    typeof i.duration_minutes === "number"
      ? i.duration_minutes
      : typeof i.duration_minutes === "string"
        ? Number.parseInt(i.duration_minutes, 10)
        : undefined;
  const runSynthesis =
    typeof i.run_synthesis === "boolean"
      ? i.run_synthesis
      : eventType === "call" || eventType === "meeting";

  const result = await logInteraction({
    partnerId,
    eventType: eventType as
      | "call"
      | "meeting"
      | "linkedin_message"
      | "linkedin_connect"
      | "whatsapp"
      | "slack"
      | "personal_note"
      | "handover_note"
      | "intel",
    eventAt,
    durationMinutes:
      typeof duration === "number" && Number.isFinite(duration)
        ? duration
        : undefined,
    title,
    notes,
    followUpDueAt: followUp,
    runSynthesis,
  });

  if (!result.ok) {
    return {
      summary: `log_interaction failed: ${result.error}`,
      data: { error: result.error },
      isError: true,
    };
  }

  const chip = [
    `log_interaction ✓ ${eventType}`,
    duration ? `${duration}m` : null,
    result.synthesis ? "+synthesis" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    summary: chip,
    data: {
      ok: true,
      contact_event_id: result.contactEventId,
      synthesis: result.synthesis
        ? {
            summary: result.synthesis.summary,
            action_items: result.synthesis.action_items,
            suggested_status: result.synthesis.suggested_status,
            suggested_follow_up_due_at:
              result.synthesis.suggested_follow_up_due_at,
          }
        : null,
    },
  };
}

interface RefineSynthesisToolInput {
  campaign_partner_id?: unknown;
}

async function runRefineSynthesis(
  input: unknown,
): Promise<ToolExecutionResult> {
  const { campaign_partner_id } = (input ?? {}) as RefineSynthesisToolInput;
  const cpid =
    typeof campaign_partner_id === "string" ? campaign_partner_id.trim() : "";
  if (!cpid) {
    return {
      summary: "refine_synthesis: campaign_partner_id missing",
      data: {
        error:
          "campaign_partner_id required. Use search_partners → resolve_campaign_partner to get one.",
      },
      isError: true,
    };
  }

  const result = await refineSynthesisWithOpus({ campaignPartnerId: cpid });
  if (!result.ok) {
    return {
      summary: `refine_synthesis failed: ${result.error}`,
      data: { error: result.error },
      isError: true,
    };
  }

  return {
    summary: `refine_synthesis ✓ angle: ${result.subjectAngle ?? "(none)"}`,
    data: {
      ok: true,
      rendered_synthesis: result.rendered,
      subject_angle: result.subjectAngle,
    },
  };
}
