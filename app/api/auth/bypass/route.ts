import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Retired. Auth bypass must never mint a session from a public URL. */
export async function GET() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
