#!/usr/bin/env node
/**
 * Weekly founder digest cron — BACKLOG.md Level 6.
 *
 * Runs once per invocation. launchd schedules it for Monday 07:00 BST
 * via ops/launchd/com.forgecapital.weekly-digest.plist. For each
 * active campaign:
 *   1. Generate a plain-text digest of the last 7 days by running the
 *      same calculations the /weekly-digest page uses.
 *   2. Look up the founder's Gmail address from gmail_tokens.email
 *      (user_id matched via campaigns.user_id).
 *   3. Send the digest via the Gmail API (same refresh-token flow
 *      send-test-email.mjs uses).
 *
 * This script deliberately re-implements the digest logic inline rather
 * than importing the server action — server actions live under Next's
 * app/ directory and pull in React / Next runtime modules that this
 * bare-Node script can't load. The logic is small enough to maintain
 * in two places; if it grows, the right move is to extract to a
 * pure-function module both the action and this script can import.
 *
 * Usage:
 *   node scripts/weekly-digest-cron.mjs             # run for all active
 *   node scripts/weekly-digest-cron.mjs --dry-run   # log, do not send
 *   node scripts/weekly-digest-cron.mjs --campaign <uuid>
 *
 * Env (read from .env.local if not already in the environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const path = join(__dirname, "..", ".env.local");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* .env.local is optional in prod; launchd plist injects vars directly. */
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!SUPABASE_URL || !SERVICE_KEY || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
  console.error("[weekly-digest] missing env (SUPABASE/GMAIL)");
  process.exit(2);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PRINT_BODY = args.includes("--print-body");
const campaignArgIdx = args.indexOf("--campaign");
const ONLY_CAMPAIGN =
  campaignArgIdx >= 0 ? args[campaignArgIdx + 1] : null;

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const STATUS_CODES = [
  "+12", "+11", "+10", "+9", "+8", "+7", "+6", "+5", "+4", "+3",
  "+2", "+1", "+0", "-1", "-2", "-3",
];
const STATUS_LABELS = {
  "+12": "Committed",
  "+11": "Term sheet",
  "+10": "NDA / diligence",
  "+9": "Meeting held",
  "+8": "Meeting scheduled",
  "+7": "Meeting offered",
  "+6": "Response received",
  "+5": "Follow-up sent",
  "+4": "Auto-reply / OOO",
  "+3": "Email sent",
  "+2": "Drafted",
  "+1": "Approved",
  "+0": "Pending approval",
  "-1": "Declined",
  "-2": "Bounced",
  "-3": "Disqualified",
};
const POST_REPLY_CODES = ["+6", "+7", "+8", "+9", "+10", "+11", "+12"];

function shortDate(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Europe/London",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function weekOfLabel(now) {
  const d = new Date(now.getTime());
  const dayIdx = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - dayIdx * MS_PER_DAY);
  return shortDate(monday.toISOString());
}

function classifyReplyTone(summary) {
  if (!summary) return "neutral";
  const s = String(summary).toLowerCase();
  const pos = [
    "happy to", "keen to", "sounds good", "let's set", "book a call",
    "schedule", "interested", "love to chat", "great — ", "yes, ", "meeting",
  ];
  const neg = [
    "not a fit", "not for us", "passing for now", "out of scope",
    "politely decline", "no thanks", "unfortunately", "not investing",
    "not the right", "don't invest",
  ];
  if (pos.some((p) => s.includes(p))) return "positive";
  if (neg.some((p) => s.includes(p))) return "negative";
  return "neutral";
}

function isSelfManaged(campaign) {
  return !((campaign?.counterpart_email ?? "").trim());
}

function partnerNounPlural(intent) {
  if (intent === "customer") return "customers";
  if (intent === "supplier") return "suppliers";
  return "investors";
}

/** Build the digest for one campaign. Returns { subject, body, stats } or null on error. */
async function buildDigest(campaign) {
  const selfManaged = isSelfManaged(campaign);
  const nounPlural = partnerNounPlural(campaign.campaign_intent);
  // Pull partners.
  const { data: partnersData, error: partnersErr } = await sb
    .from("campaign_partners")
    .select(
      `id, campaign_id, status_code, last_contact_at,
       partners_mirror:partner_id (
         name,
         investors_mirror:investor_id ( firm_name )
       )`,
    )
    .eq("campaign_id", campaign.id);
  if (partnersErr) {
    console.error(
      `[weekly-digest] partners fetch failed for ${campaign.id}:`,
      partnersErr.message,
    );
    return null;
  }
  const partners = partnersData ?? [];
  const partnersById = new Map(partners.map((p) => [p.id, p]));
  const partnerIds = partners.map((p) => p.id);

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * MS_PER_DAY);
  const upcomingEnd = new Date(now.getTime() + 7 * MS_PER_DAY);

  let events = [];
  if (partnerIds.length > 0) {
    const fourteenAgo = new Date(now.getTime() - 14 * MS_PER_DAY);
    const { data: evData, error: evErr } = await sb
      .from("contact_events")
      .select(
        "id, campaign_partner_id, direction, event_type, event_at, summary, follow_up_due_at, follow_up_done_at, title",
      )
      .in("campaign_partner_id", partnerIds)
      .gte("event_at", fourteenAgo.toISOString())
      .order("event_at", { ascending: false });
    if (evErr) {
      console.error(
        `[weekly-digest] events fetch failed for ${campaign.id}:`,
        evErr.message,
      );
      return null;
    }
    events = evData ?? [];
  }

  const inLast7 = (iso) => {
    const t = new Date(iso).getTime();
    return t >= windowStart.getTime() && t <= now.getTime();
  };

  const firmFor = (p) =>
    p?.partners_mirror?.investors_mirror?.firm_name ?? "(unknown firm)";

  const sentEvents = events.filter(
    (e) => inLast7(e.event_at) && e.direction === "outbound",
  );
  const replyEvents = events.filter(
    (e) => inLast7(e.event_at) && e.direction === "inbound",
  );
  let repliesPositive = 0, repliesNegative = 0, repliesNeutral = 0;
  for (const e of replyEvents) {
    const tone = classifyReplyTone(e.summary);
    if (tone === "positive") repliesPositive++;
    else if (tone === "negative") repliesNegative++;
    else repliesNeutral++;
  }

  const meetingEvents = events.filter((e) => {
    const isMeeting =
      e.direction === "meeting" ||
      e.event_type === "meeting" ||
      e.event_type === "meeting_scheduled" ||
      e.event_type === "meeting_held";
    if (!isMeeting) return false;
    const t = new Date(e.event_at).getTime();
    return t >= windowStart.getTime() && t <= upcomingEnd.getTime();
  });
  const meetingsByPartner = new Map();
  for (const e of meetingEvents) {
    if (!meetingsByPartner.has(e.campaign_partner_id)) {
      meetingsByPartner.set(e.campaign_partner_id, e);
    }
  }

  const latestOutboundByPartner = new Map();
  for (const e of events) {
    if (e.direction !== "outbound") continue;
    const existing = latestOutboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      latestOutboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }

  const needsFollowUp = [];
  for (const p of partners) {
    if (!p.status_code) continue;
    if (!POST_REPLY_CODES.includes(p.status_code)) continue;
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) {
      needsFollowUp.push(p);
      continue;
    }
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days > 5) needsFollowUp.push(p);
  }

  const inboundByPartner = new Map();
  for (const e of events) {
    if (e.direction !== "inbound") continue;
    const existing = inboundByPartner.get(e.campaign_partner_id);
    if (!existing || new Date(e.event_at).getTime() > new Date(existing).getTime()) {
      inboundByPartner.set(e.campaign_partner_id, e.event_at);
    }
  }
  const silentOver7d = [];
  for (const p of partners) {
    if (p.status_code !== "+3") continue;
    const lastIn = inboundByPartner.get(p.id);
    if (lastIn && new Date(lastIn).getTime() > windowStart.getTime()) continue;
    const lastOut = latestOutboundByPartner.get(p.id);
    if (!lastOut) continue;
    const days = (now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY;
    if (days >= 7) silentOver7d.push(p);
  }

  const handoverEvents = events.filter(
    (e) => inLast7(e.event_at) && e.event_type === "handover",
  );
  const handoverPartnerIds = new Set(
    handoverEvents.map((e) => e.campaign_partner_id),
  );
  const handoverPartners = partners.filter((p) => handoverPartnerIds.has(p.id));

  const declinePartners = partners.filter(
    (p) => p.status_code === "-1" && p.last_contact_at && inLast7(p.last_contact_at),
  );

  const upcomingFollowUps = events
    .filter(
      (e) =>
        e.follow_up_due_at &&
        !e.follow_up_done_at &&
        new Date(e.follow_up_due_at).getTime() >= now.getTime() &&
        new Date(e.follow_up_due_at).getTime() <= upcomingEnd.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.follow_up_due_at).getTime() -
        new Date(b.follow_up_due_at).getTime(),
    );

  const distribution = new Map();
  for (const code of STATUS_CODES) distribution.set(code, 0);
  for (const p of partners) {
    if (p.status_code && distribution.has(p.status_code)) {
      distribution.set(p.status_code, (distribution.get(p.status_code) ?? 0) + 1);
    }
  }

  const stats = {
    sent: sentEvents.length,
    replies: replyEvents.length,
    repliesPositive,
    repliesNegative,
    repliesNeutral,
    meetings_booked: meetingsByPartner.size,
    silent_over_7d: silentOver7d.length,
    handovers: handoverPartners.length,
    declines: declinePartners.length,
  };

  const weekLabel = weekOfLabel(now);
  const subject = `[DIGEST] ${campaign.name} - week of ${weekLabel}: ${stats.sent} sent, ${stats.replies} replies, ${stats.meetings_booked} meetings`;

  const lines = [];
  lines.push("Hi,");
  lines.push("");
  lines.push(`Here's what happened on ${campaign.name} in the last 7 days.`);
  lines.push("");
  lines.push("HEADLINE");
  lines.push(`* ${stats.sent} first-contacts sent`);
  lines.push(
    `* ${stats.replies} replies received (${repliesPositive} positive, ${repliesNegative} negative, ${repliesNeutral} neutral)`,
  );
  if (meetingsByPartner.size === 0) {
    lines.push(`* 0 meetings booked`);
  } else {
    const meetingLines = [];
    for (const [partnerId, ev] of meetingsByPartner.entries()) {
      const p = partnersById.get(partnerId);
      meetingLines.push(`${firmFor(p)} (${shortDate(ev.event_at)})`);
    }
    lines.push(
      `* ${stats.meetings_booked} meetings booked: ${meetingLines.join("; ")}`,
    );
  }
  // "handed over to the company" only makes sense on multi-party
  // campaigns. On self-managed ones Tristan IS the company — there's no
  // handover, and warm replies ride the positive path direct to +7.
  if (!selfManaged) {
    if (handoverPartners.length === 0) {
      lines.push(`* 0 handed over to the company`);
    } else {
      const firms = handoverPartners.map((p) => firmFor(p)).join(", ");
      lines.push(`* ${handoverPartners.length} handed over to the company: ${firms}`);
    }
  }
  if (declinePartners.length > 0) {
    const firms = declinePartners.map((p) => firmFor(p)).join(", ");
    lines.push(`* ${declinePartners.length} declined this week: ${firms}`);
  }
  lines.push("");

  lines.push("NEEDS YOUR ATTENTION");
  if (needsFollowUp.length === 0 && silentOver7d.length === 0) {
    lines.push(
      "No stuck conversations. Nothing at +6 or later has been silent for more than 5 days.",
    );
  } else {
    if (needsFollowUp.length > 0) {
      for (const p of needsFollowUp.slice(0, 20)) {
        const firm = firmFor(p);
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : null;
        const tail = days === null ? "no outbound logged" : `${days}d since last outbound`;
        lines.push(`* ${firm} [${p.status_code} ${STATUS_LABELS[p.status_code] ?? ""}] - ${tail}`);
      }
      if (needsFollowUp.length > 20) lines.push(`... and ${needsFollowUp.length - 20} more`);
    }
    if (silentOver7d.length > 0) {
      lines.push("");
      lines.push("Silent over 7 days at +3 (no reply since first contact):");
      for (const p of silentOver7d.slice(0, 20)) {
        const firm = firmFor(p);
        const lastOut = latestOutboundByPartner.get(p.id);
        const days = lastOut
          ? Math.floor((now.getTime() - new Date(lastOut).getTime()) / MS_PER_DAY)
          : 7;
        lines.push(`* ${firm} - ${days}d silent`);
      }
      if (silentOver7d.length > 20) lines.push(`... and ${silentOver7d.length - 20} more`);
    }
  }
  lines.push("");

  lines.push("UPCOMING FOLLOW-UPS (next 7 days)");
  if (upcomingFollowUps.length === 0) {
    lines.push("No follow-ups scheduled. Log a follow-up from any tracker row to populate this.");
  } else {
    for (const ev of upcomingFollowUps.slice(0, 20)) {
      const p = partnersById.get(ev.campaign_partner_id);
      const due = shortDate(ev.follow_up_due_at);
      const titleTail = ev.title ? ` - ${ev.title}` : "";
      lines.push(`* ${due}: ${firmFor(p)}${titleTail}`);
    }
    if (upcomingFollowUps.length > 20) {
      lines.push(`... and ${upcomingFollowUps.length - 20} more`);
    }
  }
  lines.push("");

  lines.push("STATUS DISTRIBUTION");
  const parts = [];
  for (const code of STATUS_CODES) {
    const n = distribution.get(code) ?? 0;
    if (n > 0) parts.push(`${code}: ${n}`);
  }
  lines.push(
    parts.length > 0
      ? parts.join(" * ")
      : `No ${nounPlural} on this campaign yet.`,
  );
  lines.push("");
  lines.push("-- auto-generated by forge-capital-app. Reply to mark done.");

  return { subject, body: lines.join("\n"), stats };
}

async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendMessage(accessToken, to, subject, body) {
  const rawHeaders = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  const rawMessage = rawHeaders.join("\r\n") + "\r\n\r\n" + body;
  const encoded = base64UrlEncode(Buffer.from(rawMessage, "utf8"));
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    },
  );
  if (!res.ok) {
    throw new Error(`gmail send ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()).id;
}

(async () => {
  console.log(
    `[weekly-digest] start${DRY_RUN ? " (dry-run)" : ""}${ONLY_CAMPAIGN ? ` campaign=${ONLY_CAMPAIGN}` : ""}`,
  );

  // Active campaigns. counterpart_email drives self-managed detection
  // (null/blank = self-managed: Tristan is sender AND recipient — see
  // lib/queries/self-managed.ts for the in-app source of truth).
  let campaignsQuery = sb
    .from("campaigns")
    .select("id, name, campaign_intent, status, counterpart_email, counterpart_name")
    .eq("status", "active");
  if (ONLY_CAMPAIGN) campaignsQuery = campaignsQuery.eq("id", ONLY_CAMPAIGN);
  const { data: campaignsData, error: campaignsErr } = await campaignsQuery;
  if (campaignsErr) {
    console.error("[weekly-digest] campaigns fetch failed:", campaignsErr.message);
    process.exit(1);
  }
  const campaigns = campaignsData ?? [];
  if (campaigns.length === 0) {
    console.log("[weekly-digest] no active campaigns; nothing to do.");
    return;
  }

  // The app is single-tenant in practice — campaigns has no user_id
  // column. The digest goes to whatever Gmail address owns the single
  // gmail_tokens row. If multi-tenant lands later, extend the schema
  // with campaigns.user_id + re-key this select.
  let fallbackToken = null;
  {
    const { data: anyToken, error: tokenErr } = await sb
      .from("gmail_tokens")
      .select("user_id, email, refresh_token")
      .limit(1);
    if (tokenErr) {
      console.error("[weekly-digest] gmail_tokens fetch failed:", tokenErr.message);
      process.exit(1);
    }
    if (anyToken && anyToken.length > 0) fallbackToken = anyToken[0];
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const campaign of campaigns) {
    const digest = await buildDigest(campaign);
    if (!digest) {
      console.error(`[weekly-digest] skip ${campaign.name}: digest build failed`);
      failed++;
      continue;
    }

    const token = fallbackToken;
    if (!token?.refresh_token || !token?.email) {
      console.log(
        `[weekly-digest] skip ${campaign.name}: no gmail_tokens row found (connect Gmail first)`,
      );
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[weekly-digest] dry-run ${campaign.name} -> ${token.email} | ${digest.subject} | sent=${digest.stats.sent} replies=${digest.stats.replies} meetings=${digest.stats.meetings_booked}`,
      );
      if (PRINT_BODY) {
        console.log("----- body -----");
        console.log(digest.body);
        console.log("----- end body -----");
      }
      sent++;
      continue;
    }

    try {
      const accessToken = await refreshAccessToken(token.refresh_token);
      const msgId = await sendMessage(
        accessToken,
        token.email,
        digest.subject,
        digest.body,
      );
      console.log(
        `[weekly-digest] sent ${campaign.name} -> ${token.email} gmail_id=${msgId} sent=${digest.stats.sent} replies=${digest.stats.replies} meetings=${digest.stats.meetings_booked}`,
      );
      sent++;
    } catch (err) {
      console.error(
        `[weekly-digest] send failed ${campaign.name} -> ${token.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log(
    `[weekly-digest] done. sent=${sent} failed=${failed} skipped=${skipped}`,
  );
})().catch((err) => {
  console.error("[weekly-digest] fatal:", err);
  process.exit(1);
});
