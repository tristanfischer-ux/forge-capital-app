import { NextRequest, NextResponse } from "next/server";
import { isAllowedSignInEmail } from "@/lib/auth-allowlist";
import { searchBook } from "@/lib/capital/search-book";
import { capitalConfigured } from "@/lib/supabase/capital";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await createServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !isAllowedSignInEmail(user.email)) {
    return NextResponse.json({ hits: [] }, { status: 401 });
  }
  if (!capitalConfigured()) {
    return NextResponse.json({ hits: [], error: "shared book not configured" });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const hits = await searchBook(q);
  return NextResponse.json({ hits });
}
