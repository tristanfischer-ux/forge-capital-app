import { capitalActor, capitalConfigured, createEngageClient } from "@/lib/supabase/capital";

export async function writeAudit(input: {
  action: string;
  entity: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}): Promise<void> {
  if (!capitalConfigured()) return;
  const engage = createEngageClient();
  const { error } = await engage.from("audit_log").insert({
    actor: capitalActor(),
    action: input.action,
    entity: input.entity,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
  });
  if (error) console.error("audit_log", error.message);
}
