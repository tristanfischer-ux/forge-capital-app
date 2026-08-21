#!/usr/bin/env node
/**
 * Fail the build if the client bundle contains service-role material.
 * Spec: any bundle containing the service-role key is a security incident.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), ".next");
const NEEDLES = [
  "service_role",
  "FORGE_CAPITAL_DB_SERVICE_ROLE",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const dirs = [
  join(ROOT, "static"),
  join(ROOT, "server", "app"),
].filter(existsSync);

if (dirs.length === 0) {
  console.error("check-client-secrets: .next output missing — run after next build");
  process.exit(2);
}

const hits = [];
for (const dir of dirs) {
  const onlyClient = dir.endsWith("static");
  if (!onlyClient) continue;
  for (const file of walk(dir)) {
    if (!/\.(js|css|json)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const n of NEEDLES) {
      if (text.includes(n)) hits.push({ file, needle: n });
    }
    // A JWT in the client bundle is expected (the anon/publishable key).
    // Fail only if a JWT payload literally names the service_role role.
    const jwt = text.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g) ?? [];
    for (const token of jwt) {
      const payload = token.split(".")[1];
      try {
        const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        if (/"role"\s*:\s*"service_role"/.test(json)) {
          hits.push({ file, needle: "jwt-role-service_role" });
        }
      } catch {
        /* not a decodable JWT fragment */
      }
    }
  }
}

if (hits.length) {
  console.error("CLIENT BUNDLE CONTAINS SERVICE-ROLE MATERIAL");
  for (const h of hits) console.error(`  ${h.needle} in ${h.file}`);
  process.exit(1);
}

console.log("check-client-secrets: ok");
