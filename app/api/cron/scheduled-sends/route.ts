import { NextRequest, NextResponse } from "next/server";

/**
 * Retired. The Raise desk does not auto-send. The Vercel cron entry
 * has been removed; this handler stays so a leftover launcher cannot
 * dispatch mail.
 */
export const maxDuration = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "scheduled sends are retired — nothing auto-sends" },
    { status: 410 },
  );
}
