#!/usr/bin/env node
/**
 * Walk every Raise desk tab and fail if a surface is empty or overlaying.
 * Usage: node scripts/verify-desk-tabs.mjs
 */
const BASE = process.env.DESK_BASE || "http://localhost:3000";

const checks = [
  {
    name: "Today",
    path: "/today",
    must: ["Raise desk", "Today —", "Quiet", "On two raises"],
    mustNot: ["desk-today cp_rows", "ReferenceError", "first 80 rows"],
    extra: (html) =>
      /Meetings \(7 days\)\s*<\/div>\s*<div class="n">0<\/div>/.test(html)
        ? "Today meetings tile is still 0"
        : null,
  },
  {
    name: "Company",
    path: "/company",
    must: ["this raise", "Permission", "Other raises", "On this raise"],
    mustNot: ["first 80 rows", "ForgeOS"],
  },
  {
    name: "Person",
    path: "/person",
    must: ["People", "Find a person or firm"],
    mustNot: ["ReferenceError"],
  },
  {
    name: "Firm",
    path: "/firm",
    must: ["Firms", "Find a person or firm"],
    mustNot: ["Encyclopaedia"],
  },
  {
    name: "Inbox",
    path: "/raise-inbox",
    must: ["Inbox", "Replies"],
    mustNot: ["No inbound rows in the last 10 days."],
  },
  {
    name: "Calendar",
    path: "/raise-calendar",
    must: ["Calendar — this week", "Mon"],
    mustNot: ["File this", "OAuth is revoked"],
    extra: (html) =>
      /Miha|Thorsten|Odysseus|Gareth|Stephan/.test(html)
        ? null
        : "Calendar HTML has no this-week meeting names",
  },
  {
    name: "Excel",
    path: "/raise-excel",
    must: ["Excel is a download", "Download snapshot", "CANONICAL"],
    mustNot: ["desk-today cp_rows"],
  },
  {
    name: "Review",
    path: "/desk-review",
    must: ["Review queue"],
    mustNot: ["ReferenceError"],
  },
];

async function main() {
  const failures = [];
  for (const check of checks) {
    const res = await fetch(BASE + check.path, { redirect: "follow" });
    const html = await res.text();
    if (res.status !== 200) {
      failures.push(`${check.name} HTTP ${res.status}`);
      continue;
    }
    for (const needle of check.must) {
      if (!html.includes(needle)) failures.push(`${check.name} missing “${needle}”`);
    }
    for (const needle of check.mustNot) {
      if (html.includes(needle)) failures.push(`${check.name} still contains “${needle}”`);
    }
    if (check.extra) {
      const extra = check.extra(html);
      if (extra) failures.push(`${check.name}: ${extra}`);
    }
    console.log(`ok  ${check.name}  ${res.status}  ${html.length}b`);
  }
  if (failures.length) {
    console.error("FAIL");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }
  console.log("PASS  all 8 desk tabs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
