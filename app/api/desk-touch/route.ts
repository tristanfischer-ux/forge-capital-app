import { NextResponse } from "next/server";
import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import { logActivity } from "@/lib/capital/rpc";
import { capitalConfigured } from "@/lib/supabase/capital";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!isAllowedSignInEmail(user.email)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const body = (await req.json()) as {
    who?: string;
    channel?: string;
    note?: string;
    due?: string;
    mandate_code?: string;
  };
  const who = (body.who ?? "").trim();
  const note = (body.note ?? "").trim();
  const channel = (body.channel ?? "whatsapp").trim();
  if (!who || !note) {
    return NextResponse.json({ error: "who and note required" }, { status: 400 });
  }
  if (!capitalConfigured()) {
    return NextResponse.json(
      { error: "shared book is not configured — not saved" },
      { status: 503 },
    );
  }

  const result = await logActivity({
    firm_name: who,
    mandate_code: body.mandate_code ?? null,
    channel,
    subject: note.slice(0, 180),
    snippet: note,
    allow_create_firm: false,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "not saved",
        suggestions: result.suggestions ?? null,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, activity: result });
}
