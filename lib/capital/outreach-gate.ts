import { createEngageClient } from "@/lib/supabase/capital";
import { writeAudit } from "@/lib/capital/audit";

export type OutreachGate = {
  allowed: boolean;
  reason: string;
};

function asGate(data: unknown): OutreachGate {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { allowed: false, reason: "check_outreach_allowed returned no row" };
  }
  const r = row as { allowed?: boolean; reason?: string };
  return {
    allowed: r.allowed === true,
    reason: String(r.reason ?? ""),
  };
}

/** Ask the database. Do not invent a parallel client-side rule. */
export async function checkOutreachAllowed(participationId: string): Promise<OutreachGate> {
  const engage = createEngageClient();
  const { data, error } = await engage.rpc("check_outreach_allowed", {
    p_participation: participationId,
  });
  if (error) return { allowed: false, reason: error.message };
  return asGate(data);
}

/**
 * The only legal way the app advances a row to approached.
 * The trigger calls check_outreach_allowed. On failure, return the
 * raised message verbatim. Never set forge.backfill.
 */
export async function advanceToApproached(participationId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const engage = createEngageClient();
  const { data: before } = await engage
    .from("participations")
    .select("id, stage, first_sent, latest_touch")
    .eq("id", participationId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Participation not found." };
  if (before.stage === "approached") return { ok: true };

  const now = new Date().toISOString();
  const { error } = await engage
    .from("participations")
    .update({
      stage: "approached",
      first_sent: before.first_sent ?? now,
      latest_touch: now,
    })
    .eq("id", participationId);

  if (error) {
    await writeAudit({
      action: "participation.approached.blocked",
      entity: `participations:${participationId}`,
      before,
      reason: error.message,
    });
    return { ok: false, error: error.message };
  }
  await writeAudit({
    action: "participation.approached",
    entity: `participations:${participationId}`,
    before,
    after: { stage: "approached" },
  });
  return { ok: true };
}
