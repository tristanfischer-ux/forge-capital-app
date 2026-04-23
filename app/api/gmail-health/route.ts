import { createServerClient } from "@/lib/supabase/server";
import { refreshAccessToken } from "@/lib/gmail/oauth";

/**
 * Live Gmail + Calendar connectivity probe.
 *
 * Returns JSON that the sticky top-bar status widget polls every 30s
 * so Tristan has a concrete "green / amber / red" signal — per his
 * 2026-04-23 ask: *"I want to have some kind of signal showing that
 * it is working, because at the moment I have no idea whether it is
 * live or not."*
 *
 * We probe BOTH services in parallel (cheap-ish but not free) so
 * degradation is identifiable per-service. Per-service fields:
 *   - status: "connected" | "scope_missing" | "expired" | "error" | "not_connected"
 *   - scopeOk: bool
 *   - sampleCount: number  (real events / threads probed)
 *   - lastSyncAt: ISO      (last time our cron touched the service)
 *   - latencyMs: round-trip of the live API ping
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ServiceStatus {
  status:
    | "connected"
    | "scope_missing"
    | "expired"
    | "error"
    | "not_connected";
  scopeOk: boolean;
  sampleCount: number | null;
  lastSyncAt: string | null;
  latencyMs: number | null;
  detail: string | null;
}

interface HealthResponse {
  gmail: ServiceStatus;
  calendar: ServiceStatus;
  scope: string | null;
  checkedAt: string;
}

function mkMissing(scopeOk: boolean, reason: string): ServiceStatus {
  return {
    status: scopeOk ? "error" : "scope_missing",
    scopeOk,
    sampleCount: null,
    lastSyncAt: null,
    latencyMs: null,
    detail: reason,
  };
}

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select(
      "access_token, refresh_token, expires_at, scope, last_gmail_sync_at, calendar_cursor",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tokenRow) {
    const missing: ServiceStatus = {
      status: "not_connected",
      scopeOk: false,
      sampleCount: null,
      lastSyncAt: null,
      latencyMs: null,
      detail: "No gmail_tokens row — user has not connected Google.",
    };
    return Response.json({
      gmail: missing,
      calendar: missing,
      scope: null,
      checkedAt: new Date().toISOString(),
    } satisfies HealthResponse);
  }

  const scope = (tokenRow.scope as string | null) ?? "";
  const scopeGmailOk =
    scope.includes("gmail.readonly") || scope.includes("gmail.compose");
  const scopeCalendarOk = scope.includes("calendar.readonly");

  // Refresh access token if expiring.
  const now = Date.now();
  const expires = tokenRow.expires_at
    ? new Date(tokenRow.expires_at).getTime()
    : 0;
  let accessToken = tokenRow.access_token as string;
  if (!accessToken || expires < now + 60_000) {
    try {
      const fresh = await refreshAccessToken(tokenRow.refresh_token as string);
      accessToken = fresh.access_token;
      await supabase
        .from("gmail_tokens")
        .update({
          access_token: fresh.access_token,
          expires_at: new Date(now + fresh.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const expiredStatus: ServiceStatus = {
        status: "expired",
        scopeOk: false,
        sampleCount: null,
        lastSyncAt: null,
        latencyMs: null,
        detail: `Token refresh failed: ${msg}. Reconnect at /api/auth/gmail.`,
      };
      return Response.json({
        gmail: expiredStatus,
        calendar: expiredStatus,
        scope,
        checkedAt: new Date().toISOString(),
      } satisfies HealthResponse);
    }
  }

  // Two probes in parallel — cheap (each is 1 item).
  const [gmailProbe, calendarProbe] = await Promise.all([
    scopeGmailOk
      ? probeGmail(accessToken)
      : Promise.resolve(mkMissing(false, "Scope gmail.readonly not granted.")),
    scopeCalendarOk
      ? probeCalendar(accessToken)
      : Promise.resolve(
          mkMissing(false, "Scope calendar.readonly not granted. Reconnect at /api/auth/gmail."),
        ),
  ]);

  gmailProbe.lastSyncAt = (tokenRow.last_gmail_sync_at as string | null) ?? null;
  calendarProbe.lastSyncAt = (tokenRow.calendar_cursor as string | null) ?? null;

  return Response.json({
    gmail: gmailProbe,
    calendar: calendarProbe,
    scope,
    checkedAt: new Date().toISOString(),
  } satisfies HealthResponse);
}

async function probeGmail(accessToken: string): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    const latency = Date.now() - started;
    if (res.ok) {
      const body = (await res.json()) as { resultSizeEstimate?: number };
      return {
        status: "connected",
        scopeOk: true,
        sampleCount: body.resultSizeEstimate ?? null,
        lastSyncAt: null,
        latencyMs: latency,
        detail: null,
      };
    }
    const text = await res.text();
    return {
      status: "error",
      scopeOk: true,
      sampleCount: null,
      lastSyncAt: null,
      latencyMs: latency,
      detail: `Gmail API ${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      scopeOk: true,
      sampleCount: null,
      lastSyncAt: null,
      latencyMs: Date.now() - started,
      detail: `Gmail probe threw: ${msg}`,
    };
  }
}

async function probeCalendar(accessToken: string): Promise<ServiceStatus> {
  const started = Date.now();
  try {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set(
      "timeMin",
      new Date(Date.now() - 7 * 86_400_000).toISOString(),
    );
    url.searchParams.set("maxResults", "1");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - started;
    if (res.ok) {
      const body = (await res.json()) as { items?: Array<{ id: string }> };
      return {
        status: "connected",
        scopeOk: true,
        sampleCount: body.items?.length ?? 0,
        lastSyncAt: null,
        latencyMs: latency,
        detail: null,
      };
    }
    const text = await res.text();
    return {
      status: "error",
      scopeOk: true,
      sampleCount: null,
      lastSyncAt: null,
      latencyMs: latency,
      detail: `Calendar API ${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      scopeOk: true,
      sampleCount: null,
      lastSyncAt: null,
      latencyMs: Date.now() - started,
      detail: `Calendar probe threw: ${msg}`,
    };
  }
}
