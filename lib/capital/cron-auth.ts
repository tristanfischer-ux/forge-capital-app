import type { NextRequest } from "next/server";

/** Vercel Cron sends Authorization: Bearer $CRON_SECRET. Never log the secret. */
export function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
