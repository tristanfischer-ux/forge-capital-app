import { NextResponse } from "next/server";
import { lookupRegistry, roleLabel } from "@/lib/desk/identity";
import { applyCancellations, readDeskWeekCache } from "@/lib/queries/desk-calendar";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cache = await readDeskWeekCache();
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  let googleOk = false;
  if (auth.user) {
    const { data } = await supabase
      .from("gmail_tokens")
      .select("expires_at, refresh_token")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    googleOk = Boolean(data?.refresh_token);
  }
  return NextResponse.json({
    generated_at: cache.generated_at,
    meetings: applyCancellations(cache.meetings, cache.replies).map((m) => {
      const role = lookupRegistry({
        name: m.partner_name ?? m.title,
        email: m.attendee_emails?.[0],
      });
      return { ...m, role_label: role ? roleLabel(role.role) : null };
    }),
    replies: cache.replies,
    google_ok: googleOk,
  });
}
