import { createClient } from "@supabase/supabase-js";

/**
 * Forge Capital shared book (ForgeOS Corpus).
 * Schemas: core (firms/people), engage (mandates/participations).
 * Never import this from a client component. Never log the service role.
 */
const ACTOR = "app" as const;

function url(): string {
  const u = process.env.FORGE_CAPITAL_DB_URL;
  if (!u) throw new Error("FORGE_CAPITAL_DB_URL is not set");
  return u;
}

function serviceRole(): string {
  const k = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
  if (!k) throw new Error("FORGE_CAPITAL_DB_SERVICE_ROLE is not set");
  return k;
}

export function capitalConfigured(): boolean {
  return Boolean(
    process.env.FORGE_CAPITAL_DB_URL && process.env.FORGE_CAPITAL_DB_SERVICE_ROLE,
  );
}

export function createCoreClient() {
  const schema = "core";
  return createClient(url(), serviceRole(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    global: { headers: { "Accept-Profile": schema, "Content-Profile": schema } },
  });
}

export function createEngageClient() {
  const schema = "engage";
  return createClient(url(), serviceRole(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    global: { headers: { "Accept-Profile": schema, "Content-Profile": schema } },
  });
}

export function capitalActor(): typeof ACTOR {
  return ACTOR;
}
