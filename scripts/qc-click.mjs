#!/usr/bin/env node
/**
 * Walk every internal desk link. Uses the local bypass cookie.
 * Exit 1 if any 404/500 (except known missing seeds).
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.QC_BASE || "http://localhost:3000";
const COOKIE = "fc_auth_bypass=1";

const SEEDS = [
  "/today",
  "/call",
  "/chasers",
  "/outreach",
  "/chasers?days=10",
  "/send",
  "/send/FF",
  "/notes",
  "/raise-inbox",
  "/raise-calendar",
  "/discover",
  "/sign-off?code=SS",
  "/verify-book",
  "/collisions",
  "/raise-excel",
  "/log",
  "/person",
  "/firm",
];

const SKIP = [
  /^https?:\/\/(?!localhost)/,
  /^mailto:/,
  /^tel:/,
  /^#/,
  /^\/api\/auth\/gmail/,
  /^\/api\/export/,
];

function internal(href, from) {
  if (!href) return null;
  if (href.startsWith("javascript:")) return null;
  if (SKIP.some((re) => re.test(href))) return null;
  try {
    const u = new URL(href, BASE + from);
    if (u.origin !== new URL(BASE).origin) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { Cookie: COOKIE, Accept: "text/html" },
    redirect: "follow",
  });
  const body = await res.text();
  return { status: res.status, url: res.url, body };
}

const hrefRe = /(?:href|action)=["']([^"']+)["']/gi;
const seen = new Set();
const queue = [...SEEDS];
const report = [];
const MAX = Number(process.env.QC_MAX || 80);

while (queue.length && seen.size < MAX) {
  const path = queue.shift();
  if (!path || seen.has(path)) continue;
  seen.add(path);
  let row;
  try {
    const { status, body } = await get(path);
    const fail = status >= 400;
    row = { path, status, fail, bytes: body.length };
    if (!fail) {
      let m;
      hrefRe.lastIndex = 0;
      while ((m = hrefRe.exec(body))) {
        const next = internal(m[1], path);
        if (next && !seen.has(next) && !next.startsWith("/_next")) queue.push(next);
      }
    }
  } catch (err) {
    row = { path, status: 0, fail: true, error: err instanceof Error ? err.message : String(err) };
  }
  report.push(row);
  const mark = row.fail ? "FAIL" : "ok  ";
  console.log(`${mark} ${row.status || "ERR"} ${path}`);
}

const fails = report.filter((r) => r.fail);
writeFileSync("data/qc-click-report.json", JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
console.log(`checked ${report.length} urls, fails ${fails.length}`);
if (fails.length) {
  process.exit(1);
}
