import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { lookupRegistry } from "@/lib/desk/identity";

export const dynamic = "force-dynamic";

const FILE = join(process.cwd(), "data/desk-touches.json");

function loadTouches(): unknown[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as unknown[];
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json()) as {
    who?: string;
    channel?: string;
    note?: string;
    due?: string;
    queued_at?: string;
  };
  const who = (body.who ?? "").trim();
  const note = (body.note ?? "").trim();
  const channel = (body.channel ?? "whatsapp").trim();
  if (!who || !note) {
    return NextResponse.json({ error: "who and note required" }, { status: 400 });
  }

  const touch = {
    id: `touch-${Date.now()}`,
    who,
    channel,
    note,
    due: body.due ?? null,
    queued_at: body.queued_at ?? new Date().toISOString(),
    landed_at: new Date().toISOString(),
  };

  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const all = loadTouches();
  all.unshift(touch);
  writeFileSync(FILE, JSON.stringify(all.slice(0, 500), null, 2));

  const role = lookupRegistry({ name: who });
  const email = role?.email;
  if (email) {
    try {
      const supabase = createAdminClient();
      const { data: partner } = await supabase
        .from("partners_mirror")
        .select("id")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      if (partner?.id) {
        const { data: cp } = await supabase
          .from("campaign_partners")
          .select("id")
          .eq("partner_id", partner.id)
          .limit(1)
          .maybeSingle();
        if (cp?.id) {
          await supabase.from("contact_events").insert({
            campaign_partner_id: cp.id,
            channel,
            direction: "outbound",
            event_type: "note",
            summary: note.slice(0, 200),
            notes: note,
            event_at: new Date().toISOString(),
          });
        }
      }
    } catch {
      /* file log is enough on the road */
    }
  }

  return NextResponse.json({ ok: true, touch });
}
