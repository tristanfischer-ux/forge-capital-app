/**
 * Whether "Send digest to me" may touch Gmail / tokens / weekly_digest_log.
 * Production always may. Local `next dev` (VERCEL_ENV unset, NODE_ENV
 * development) may. Preview and other non-production deploys must not.
 */
export function canSendDigest(env: {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}): { ok: true } | { ok: false; error: string } {
  if (env.VERCEL_ENV === "production") return { ok: true };
  if (!env.VERCEL_ENV && env.NODE_ENV === "development") return { ok: true };
  return {
    ok: false,
    error: `Sending is disabled outside production (VERCEL_ENV=${env.VERCEL_ENV}).`,
  };
}
