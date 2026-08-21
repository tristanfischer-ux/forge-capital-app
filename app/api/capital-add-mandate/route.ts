import { NextResponse } from "next/server";
import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import {
  capitalActor,
  capitalConfigured,
  createEngageClient,
} from "@/lib/supabase/capital";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !isAllowedSignInEmail(user.email)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!capitalConfigured()) {
    return NextResponse.json({ error: "shared book not configured" }, { status: 503 });
  }
  const body = (await req.json()) as {
    firm_id?: string;
    person_id?: string | null;
    mandate_code?: string;
  };
  const firmId = body.firm_id?.trim();
  const code = body.mandate_code?.trim()?.toUpperCase();
  if (!firmId || !code) {
    return NextResponse.json({ error: "firm and mandate required" }, { status: 400 });
  }
  const engage = createEngageClient();
  const { data: mandate, error: mErr } = await engage
    .from("mandates")
    .select("id, code, status, narrative_notes")
    .eq("code", code)
    .maybeSingle();
  if (mErr || !mandate) {
    return NextResponse.json({ error: "unknown mandate" }, { status: 400 });
  }
  const { error } = await engage.from("participations").insert({
    firm_id: firmId,
    person_id: body.person_id ?? null,
    mandate_id: mandate.id,
    stage: "research",
    created_by: capitalActor(),
  });
  if (error) {
    if (/unique|duplicate/i.test(error.message)) {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true, already: false, notes: mandate.narrative_notes });
}
