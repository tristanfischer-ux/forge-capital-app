#!/usr/bin/env node
/**
 * Trampoline: run the TypeScript doctor with tsx so it can import the
 * shared digest module. Env must already be loaded (node --env-file=...).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = join(root, "node_modules/tsx/dist/cli.mjs");
const script = join(root, "scripts/doctor-digest-reconcile.ts");

if (!existsSync(tsx)) {
  console.error("tsx is not installed in node_modules. Run npm ci after pulling the lockfile.");
  process.exit(2);
}

const result = spawnSync(process.execPath, [tsx, script, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(result.status ?? 1);
