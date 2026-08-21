import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/capital/cron-auth";
import { verifyPersonEmail } from "@/lib/capital/neverbounce";
import { bumpSyncState } from "@/lib/capital/rpc";
import { createCoreClient, createEngageClient } from "@/lib/supabase/capital";

export const maxDuration = 300;

const NIGHTLY_CAP = 40;

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const engage = createEngageClient();
  const core = createCoreClient();
  const { data: parts } = await engage
    .from("participations")
    .select("person_id")
    .in("stage", ["approved", "approached", "responded", "meeting", "awaiting_signoff"])
    .not("person_id", "is", null)
    .limit(500);
  const ids = [...new Set((parts ?? []).map((p) => p.person_id).filter(Boolean))] as string[];
  if (!ids.length) {
    await bumpSyncState("neverbounce");
    return NextResponse.json({ message: "no people in active pipeline", verified: 0 });
  }
  const { data: people } = await core
    .from("people")
    .select("id, email, email_state")
    .in("id", ids)
    .not("email", "is", null)
    .in("email_state", ["unknown", "inferred"]);
  const batch = (people ?? []).slice(0, NIGHTLY_CAP);
  const counts: Record<string, number> = {};
  let errors = 0;
  for (const p of batch) {
    const result = await verifyPersonEmail(p.id);
    if (!result.ok) errors++;
    counts[result.email_state] = (counts[result.email_state] ?? 0) + 1;
  }
  if (errors) await bumpSyncState("neverbounce", `${errors} verify errors`);
  else await bumpSyncState("neverbounce");
  return NextResponse.json({
    message: "NeverBounce nightly for active pipeline",
    attempted: batch.length,
    counts,
    errors,
  });
}
