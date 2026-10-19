/**
 * Read-only proof for the weekly-digest reconcile.
 * Loads SkySails Power and Panatere, renders at 2026-10-19T07:00:00Z,
 * writes out/digest-reconcile/*, asserts, exits non-zero on failure.
 * Never sends mail, never writes to Apex/ForgeOS, never refreshes Gmail tokens.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { resolveApexUrl } from "./resolve-apex-url";
import { buildWeeklyDigest } from "../lib/digest/build-weekly-digest";
import {
  listCampaignMandateMappings,
  loadWeeklyDigest,
} from "../lib/digest/load-weekly-digest";
import { capitalConfigured, createEngageClient } from "../lib/supabase/capital";
import { MS_PER_DAY } from "../lib/digest/names";
import type { WeeklyDigestResult } from "../lib/digest/types";
import {
  buildLegacyWeeklyDigest,
  type LegacyCampaign,
  type LegacyEvent,
  type LegacyPartner,
} from "./legacy-weekly-digest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "out", "digest-reconcile");
const NOW = new Date("2026-10-19T07:00:00.000Z");
const BANNED_GMAIL = [
  "1a1441b2ab72c000",
  "1a146143a4add3af",
  "1a110bead333860c",
];

type Check = { name: string; pass: boolean; detail: string };

function apexClient() {
  const url = resolveApexUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function pageRange<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null } | unknown>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const res = (await run(from, from + 999)) as {
      data: T[] | null;
      error: { message: string } | null;
    };
    if (res.error) throw new Error(res.error.message);
    out.push(...(res.data ?? []));
    if (!res.data || res.data.length < 1000) break;
  }
  return out;
}

async function loadLegacy(
  apex: ReturnType<typeof apexClient>,
  campaign: LegacyCampaign,
): Promise<{ partners: LegacyPartner[]; events: LegacyEvent[] }> {
  const partners = await pageRange<LegacyPartner>((from, to) =>
    apex
      .from("campaign_partners")
      .select(
        `id, campaign_id, status_code, last_contact_at,
         partners_mirror:partner_id (
           name,
           investors_mirror:investor_id ( firm_name )
         )`,
      )
      .eq("campaign_id", campaign.id)
      .range(from, to),
  );
  const partnerIds = partners.map((p) => p.id);
  const fourteenAgo = new Date(NOW.getTime() - 14 * MS_PER_DAY).toISOString();
  const events: LegacyEvent[] = [];
  for (let i = 0; i < partnerIds.length; i += 80) {
    const chunk = partnerIds.slice(i, i + 80);
    const { data, error } = await apex
      .from("contact_events")
      .select(
        "id, campaign_partner_id, direction, event_type, event_at, summary, follow_up_due_at, follow_up_done_at, title",
      )
      .in("campaign_partner_id", chunk)
      .gte("event_at", fourteenAgo)
      .order("event_at", { ascending: false });
    if (error) throw new Error(error.message);
    events.push(...((data ?? []) as LegacyEvent[]));
  }
  return { partners, events };
}

function countPhrase(body: string, phrase: string): number {
  let n = 0;
  let from = 0;
  while (true) {
    const i = body.indexOf(phrase, from);
    if (i < 0) break;
    n += 1;
    from = i + phrase.length;
  }
  return n;
}

function attentionSection(body: string): string {
  const start = body.indexOf("NEEDS YOUR ATTENTION");
  const end = body.indexOf("UPCOMING FOLLOW-UPS");
  if (start < 0) return "";
  return body.slice(start, end < 0 ? undefined : end);
}

async function main() {
  if (!capitalConfigured()) {
    console.error("FAIL  ForgeOS env missing (FORGE_CAPITAL_DB_URL / FORGE_CAPITAL_DB_SERVICE_ROLE)");
    process.exit(2);
  }
  const apex = apexClient();
  mkdirSync(OUT_DIR, { recursive: true });

  const mappings = await listCampaignMandateMappings(apex);
  console.log("mapped campaigns:");
  for (const m of mappings.mapped) console.log(`  ${m.code}  ${m.name}  ${m.mandate_id}`);
  console.log("unmapped campaigns:");
  for (const u of mappings.unmapped) console.log(`  ${u.name}  ${u.reason}`);

  const { data: campaigns, error: cErr } = await apex
    .from("campaigns")
    .select("id, name, campaign_intent, counterpart_email, status")
    .eq("status", "active");
  if (cErr) throw new Error(cErr.message);
  const skRow = (campaigns ?? []).find((c) => c.name === "SkySails Power");
  const paRow = (campaigns ?? []).find((c) => c.name === "Panatere");
  if (!skRow || !paRow) {
    throw new Error("SkySails Power or Panatere campaign not found");
  }

  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  async function renderOne(label: string, campaign: LegacyCampaign) {
    const loaded = await loadWeeklyDigest({
      campaignId: campaign.id,
      now: NOW,
      apex,
    });
    if (!loaded.ok) throw new Error(`${label} load failed: ${loaded.error}`);
    const after = buildWeeklyDigest(loaded.data, NOW);
    const legacyInput = await loadLegacy(apex, campaign);
    const legacy = buildLegacyWeeklyDigest({
      campaign,
      partners: legacyInput.partners,
      events: legacyInput.events,
      now: NOW,
    });
    return { loaded: loaded.data, after, legacy };
  }

  const sk = await renderOne("SkySails Power", skRow as LegacyCampaign);
  const pa = await renderOne("Panatere", paRow as LegacyCampaign);

  writeFileSync(join(OUT_DIR, "skysails-after.txt"), `${sk.after.subject}\n\n${sk.after.body}\n`);
  writeFileSync(join(OUT_DIR, "panatere-after.txt"), `${pa.after.subject}\n\n${pa.after.body}\n`);
  writeFileSync(join(OUT_DIR, "skysails-legacy.txt"), `${sk.legacy.subject}\n\n${sk.legacy.body}\n`);
  writeFileSync(join(OUT_DIR, "panatere-legacy.txt"), `${pa.legacy.subject}\n\n${pa.legacy.body}\n`);

  const allCounted = [
    ...sk.after.debug.counted_gmail_ids,
    ...pa.after.debug.counted_gmail_ids,
  ];
  const bannedHit = allCounted.filter((id) => BANNED_GMAIL.includes(id));
  add(
    "banned gmail ids not counted",
    bannedHit.length === 0,
    bannedHit.length ? bannedHit.join(",") : "none of the three known ids",
  );

  const engage = createEngageClient();
  const countedKeys: string[] = [];
  for (const id of allCounted) {
    countedKeys.push(id, `gmail:${id}`);
  }
  let foreignLinked = 0;
  const foreignDetail: string[] = [];
  if (countedKeys.length) {
    const { data: acts } = await engage
      .from("activities")
      .select("id, source_id")
      .in("source_id", countedKeys);
    const actIds = (acts ?? []).map((a) => a.id);
    if (actIds.length) {
      const { data: links } = await engage
        .from("activity_links")
        .select("activity_id, entity_id")
        .eq("entity_type", "mandate")
        .in("activity_id", actIds);
      const { data: mandates } = await engage.from("mandates").select("id, code");
      const codeBy = new Map((mandates ?? []).map((m) => [m.id, m.code]));
      const skCode = sk.after.debug.mandate_id;
      const paCode = pa.after.debug.mandate_id;
      const actSource = new Map((acts ?? []).map((a) => [a.id, a.source_id]));
      for (const link of links ?? []) {
        const src = String(actSource.get(link.activity_id) ?? "");
        const bare = src.startsWith("gmail:") ? src.slice(6) : src;
        const expected =
          sk.after.debug.counted_gmail_ids.includes(bare) ? skCode : paCode;
        if (expected && link.entity_id !== expected) {
          foreignLinked += 1;
          foreignDetail.push(`${bare}->${codeBy.get(link.entity_id) ?? link.entity_id}`);
        }
      }
    }
  }
  add(
    "no counted message linked to a different mandate",
    foreignLinked === 0,
    foreignLinked ? foreignDetail.join(",") : "all counted gmail ids match the campaign mandate or have no mandate link",
  );

  const skBody = sk.after.body;
  const paBody = pa.after.body;
  const dncHit =
    /Sandbrook|Sanbrook|DO NOT CONTACT/i.test(skBody) ||
    /Sandbrook|Sanbrook|DO NOT CONTACT/i.test(paBody);
  add(
    "no dnc/blocked/-3 firm named in either render",
    !dncHit,
    dncHit ? "Sandbrook/Sanbrook/DNC still in body" : "cleared",
  );

  const merged = [...sk.after.debug.merged_firms, ...sk.after.debug.suppressed_firms];
  const sandGroup = merged.find(
    (g) => g.investor_ids.includes(3009) && g.investor_ids.includes(3072),
  );
  add(
    "Apex investors 3009 and 3072 merge to one firm key",
    Boolean(sandGroup),
    sandGroup ? `key=${sandGroup.key} name=${sandGroup.name}` : "not merged",
  );
  add(
    "Sandbrook/Sanbrook absent from SkySails render",
    !/Sandbrook|Sanbrook/i.test(skBody),
    /Sandbrook|Sanbrook/i.test(skBody) ? "still present" : "absent",
  );

  const otbCount = countPhrase(skBody, "OTB Ventures");
  add("OTB Ventures appears exactly once in SkySails", otbCount === 1, `count=${otbCount}`);

  function checkAttention(label: string, result: WeeklyDigestResult) {
    const section = attentionSection(result.body);
    let ok = true;
    const notes: string[] = [];
    for (const row of result.debug.attention) {
      const lineNeedle = `* ${row.name} [`;
      const inBody = section.includes(lineNeedle);
      if (!inBody) {
        ok = false;
        notes.push(`missing line for ${row.name}`);
        continue;
      }
      const hasNoOut = section.includes(`* ${row.name} [`) &&
        [...section.split("\n")].some(
          (ln) => ln.startsWith(`* ${row.name} [`) && ln.includes("no outbound logged"),
        );
      const noForgeos = !row.forgeos_outbound_at;
      if (noForgeos !== hasNoOut) {
        ok = false;
        notes.push(
          `${row.name}: forgeos=${row.forgeos_outbound_at ?? "none"} printed=${row.printed}`,
        );
      }
      if (!noForgeos && row.days != null && row.forgeos_outbound_at) {
        const expected = Math.floor(
          (NOW.getTime() - new Date(row.forgeos_outbound_at).getTime()) / MS_PER_DAY,
        );
        const printedDays = row.printed.match(/^(\d+)d since last outbound$/);
        const usedLaterApex =
          row.apex_outbound_at &&
          new Date(row.apex_outbound_at).getTime() >
            new Date(row.forgeos_outbound_at).getTime();
        if (!usedLaterApex && printedDays && Number(printedDays[1]) !== expected) {
          ok = false;
          notes.push(
            `${row.name}: printed ${printedDays[1]}d expected ${expected}d from ForgeOS`,
          );
        }
      }
    }
    add(
      `${label} NEEDS YOUR ATTENTION outbound phrase matches ForgeOS`,
      ok,
      notes.length ? notes.join("; ") : `${result.debug.attention.length} rows`,
    );
  }
  checkAttention("SkySails", sk.after);
  checkAttention("Panatere", pa.after);

  {
    const savedUrl = process.env.FORGE_CAPITAL_DB_URL;
    const savedRole = process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
    delete process.env.FORGE_CAPITAL_DB_URL;
    delete process.env.FORGE_CAPITAL_DB_SERVICE_ROLE;
    try {
      const refused = await loadWeeklyDigest({
        campaignId: skRow.id,
        now: NOW,
        apex,
      });
      add(
        "loader refuses when ForgeOS env is missing",
        !refused.ok,
        refused.ok
          ? "rendered without ForgeOS"
          : refused.error,
      );
    } finally {
      if (savedUrl !== undefined) process.env.FORGE_CAPITAL_DB_URL = savedUrl;
      if (savedRole !== undefined) process.env.FORGE_CAPITAL_DB_SERVICE_ROLE = savedRole;
    }
  }

  const report = {
    now: NOW.toISOString(),
    mapped: mappings.mapped,
    unmapped: mappings.unmapped,
    skysails: {
      stats: sk.after.stats,
      legacy_stats: sk.legacy.stats,
      dropped_events: sk.after.debug.dropped_events,
      suppressed_firms: sk.after.debug.suppressed_firms,
      merged_firms: sk.after.debug.merged_firms,
      attention: sk.after.debug.attention,
      silent: sk.after.debug.silent,
      counted_gmail_ids: sk.after.debug.counted_gmail_ids,
    },
    panatere: {
      stats: pa.after.stats,
      legacy_stats: pa.legacy.stats,
      dropped_events: pa.after.debug.dropped_events,
      suppressed_firms: pa.after.debug.suppressed_firms,
      merged_firms: pa.after.debug.merged_firms,
      attention: pa.after.debug.attention,
      silent: pa.after.debug.silent,
      counted_gmail_ids: pa.after.debug.counted_gmail_ids,
    },
    assertions: checks,
  };
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");

  const failed = checks.filter((c) => !c.pass);
  console.log(`\nwrote ${OUT_DIR}`);
  if (failed.length) {
    console.error(`${failed.length} assertion(s) failed`);
    process.exit(1);
  }
  console.log("ALL PASS");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
