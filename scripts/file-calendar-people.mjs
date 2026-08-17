#!/usr/bin/env node
/**
 * File calendar attendees into investors_mirror + partners_mirror +
 * campaign_partners, then write correspondence + a cheat sheet per meeting.
 *
 * Identity is unique email. Firm comes from the domain (or an existing
 * Forge Capital row). A raise is attached only when mail or the invite
 * names one — we do not invent a raise from a Calendly slot.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = (() => {
  try {
    return require("better-sqlite3");
  } catch {
    return null;
  }
})();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[line.slice(0, i).trim()] = v;
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SQLITE = "/Users/tristanfischer/.forge-capital/forge-capital.db";
const sqlite = Database && existsSync(SQLITE) ? new Database(SQLITE) : null;

const SELF = new Set([
  "tristan.fischer@gmail.com",
  "tristanfischer@gmail.com",
]);

const DOMAIN_FIRM = {
  "project-a.vc": { name: "Project A", website: "https://www.project-a.vc/", sqliteId: 2731 },
  "avealto.com": { name: "AVEALTO", website: "https://www.avealto.com/" },
  "atlantium.com": { name: "Atlantium", website: "https://www.atlantium.com/" },
  "frea-solutions.com": { name: "FREA Solutions", website: "https://www.frea-solutions.com/" },
  "marinepowersystems.co.uk": { name: "Marine Power Systems", website: "https://www.marinepowersystems.co.uk/" },
  "joneseng.com": { name: "Jones Engineering", website: "https://www.joneseng.com/" },
  "matluling.no": { name: "Matluling", website: "https://www.matluling.no/" },
  "nyu.edu": { name: "NYU", website: "https://www.nyu.edu/" },
};

const RAISE_HINTS = [
  { re: /hooley|phantm|antenna|airship|e-band|steerable/i, name: "Hooley RF" },
  { re: /fishfrom|aquaculture|ras\b|geosmin/i, name: "FishFrom Technologies" },
  { re: /odysseus/i, name: "Odysseus Space" },
  { re: /space solar/i, name: "Space Solar" },
  { re: /skysails/i, name: "SkySails Power" },
  { re: /panatere/i, name: "Panatere" },
  { re: /casper funding/i, name: "Casper Funding" },
  { re: /us arbitrage/i, name: "US Arbitrage" },
];

function domainOf(email) {
  return (email.split("@")[1] || "").toLowerCase();
}

async function gmailToken() {
  const { data } = await supabase
    .from("gmail_tokens")
    .select("access_token, refresh_token, expires_at")
    .limit(1)
    .maybeSingle();
  if (!data?.refresh_token) return null;
  const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (data.access_token && exp > Date.now() + 60_000) return data.access_token;
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    console.error("gmail refresh", await res.text());
    return null;
  }
  const json = await res.json();
  await supabase
    .from("gmail_tokens")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("refresh_token", data.refresh_token);
  return json.access_token;
}

async function searchMail(token, email) {
  const q = `(from:${email} OR to:${email}) -from:calendly.com -from:boardy.ai`;
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "12");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error("gmail list", email, res.status, await res.text());
    return [];
  }
  const list = (await res.json()).messages ?? [];
  const out = [];
  for (const m of list.slice(0, 8)) {
    const full = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!full.ok) continue;
    const body = await full.json();
    const headers = Object.fromEntries(
      (body.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
    );
    out.push({
      id: body.id,
      threadId: body.threadId,
      from: headers.from ?? "",
      to: headers.to ?? "",
      subject: headers.subject ?? "",
      date: headers.date ?? "",
      snippet: body.snippet ?? "",
    });
  }
  return out;
}

function guessRaise(blobs, campaigns) {
  const text = blobs.join("\n");
  for (const h of RAISE_HINTS) {
    if (!h.re.test(text)) continue;
    const camp = campaigns.find((c) => c.name === h.name);
    if (camp) return camp;
  }
  return null;
}

async function nextIds() {
  const [{ data: p }, { data: i }] = await Promise.all([
    supabase.from("partners_mirror").select("id").order("id", { ascending: false }).limit(1),
    supabase.from("investors_mirror").select("id").order("id", { ascending: false }).limit(1),
  ]);
  return {
    partner: Math.max(900_000, (p?.[0]?.id ?? 0) + 1),
    firm: Math.max(90_000, (i?.[0]?.id ?? 0) + 1),
  };
}

async function ensureFirm(domain, hint) {
  const spec = DOMAIN_FIRM[domain] ?? {
    name: hint?.name ?? domain,
    website: `https://${domain}`,
  };
  if (spec.sqliteId) {
    const { data } = await supabase
      .from("investors_mirror")
      .select("id, firm_name, website, thesis_summary")
      .eq("id", spec.sqliteId)
      .maybeSingle();
    if (data) {
      if (!data.firm_name) {
        await supabase
          .from("investors_mirror")
          .update({ firm_name: spec.name, website: spec.website })
          .eq("id", spec.sqliteId);
      }
      return { id: spec.sqliteId, firm_name: spec.name, website: spec.website, thesis_summary: data.thesis_summary };
    }
  }
  const { data: bySite } = await supabase
    .from("investors_mirror")
    .select("id, firm_name, website, thesis_summary")
    .ilike("website", `%${domain}%`)
    .limit(1)
    .maybeSingle();
  if (bySite?.id) {
    if (!bySite.firm_name) {
      await supabase
        .from("investors_mirror")
        .update({ firm_name: spec.name })
        .eq("id", bySite.id);
    }
    return { ...bySite, firm_name: bySite.firm_name ?? spec.name };
  }
  const ids = await nextIds();
  const firm = {
    id: ids.firm,
    firm_name: spec.name,
    website: spec.website,
    type: "desk_filed",
  };
  const { error } = await supabase.from("investors_mirror").insert(firm);
  if (error) throw new Error(`firm insert ${spec.name}: ${error.message}`);
  if (sqlite) {
    try {
      sqlite
        .prepare(
          "insert or ignore into investors (id, firm_name, website, type, created_at, updated_at) values (?, ?, ?, 'desk_filed', datetime('now'), datetime('now'))",
        )
        .run(firm.id, firm.firm_name, firm.website);
    } catch (e) {
      console.warn("sqlite firm", e.message);
    }
  }
  return { ...firm, thesis_summary: null };
}

async function ensurePartner({ name, email, firm }) {
  const { data: existing } = await supabase
    .from("partners_mirror")
    .select("id, name, email, investor_id")
    .eq("email", email)
    .maybeSingle();
  if (existing?.id) {
    if (!existing.name && name) {
      await supabase.from("partners_mirror").update({ name }).eq("id", existing.id);
    }
    return existing.id;
  }
  const ids = await nextIds();
  const row = {
    id: ids.partner,
    investor_id: firm.id,
    name,
    email,
    kind: "investor",
    email_tier: "corresponded",
    email_tier_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("partners_mirror").insert(row);
  if (error) throw new Error(`partner insert ${email}: ${error.message}`);
  if (sqlite) {
    try {
      sqlite
        .prepare(
          "insert or ignore into investor_partners (id, investor_id, name, email, email_tier, created_at, updated_at) values (?, ?, ?, ?, 'corresponded', datetime('now'), datetime('now'))",
        )
        .run(row.id, firm.id, name, email);
    } catch (e) {
      console.warn("sqlite partner", e.message);
    }
  }
  return row.id;
}

async function ensureCampaignPartner(campaignId, partnerId, eventAt) {
  const { data: existing } = await supabase
    .from("campaign_partners")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("campaign_partners")
      .update({
        status_code: "+8",
        status_label: "Meeting scheduled",
        last_contact_at: eventAt,
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await supabase
    .from("campaign_partners")
    .insert({
      campaign_id: campaignId,
      partner_id: partnerId,
      status_code: "+8",
      status_label: "Meeting scheduled",
      last_contact_at: eventAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cp insert: ${error.message}`);
  return data.id;
}

async function writeBrief({ meeting, firm, partnerId, campaign, mail }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const correspondence = mail
    .map(
      (m) =>
        `${m.date} | ${m.from} → ${m.to}\n${m.subject}\n${m.snippet}`,
    )
    .join("\n\n");
  const prompt = `Write a one-screen cheat sheet for Tristan Fischer before this call. British spelling. Do not invent facts. If mail does not name a raise, say so.

Person: ${meeting.partner_name}
Email: ${(meeting.attendee_emails || []).join(", ")}
Firm: ${firm.firm_name} (${firm.website || ""})
Firm thesis on file: ${firm.thesis_summary || "none"}
Calendar title: ${meeting.title}
Calendar notes: ${(meeting.notes || "").slice(0, 600)}
Raise we can prove: ${campaign?.name || "none — do not invent one"}

Correspondence (newest last):
${correspondence || "No mail besides a Calendly booking."}

Return JSON only:
{
  "who": "2 sentences on who they are",
  "firm": "2 sentences on the firm",
  "why_this_call": "what this slot is about, from the mail and invite only",
  "focus": ["3 short bullets of what Tristan should hit"],
  "raise": "named raise or 'not a raise meeting — inbound / customer / other'",
  "email_story": "who emailed whom, in one paragraph"
}`;

  if (!apiKey) {
    return {
      who: `${meeting.partner_name} at ${firm.firm_name}.`,
      firm: firm.thesis_summary || firm.firm_name,
      why_this_call: meeting.title,
      focus: ["Read the correspondence below"],
      raise: campaign?.name || "not a raise meeting — inbound / customer / other",
      email_story: correspondence ? `${mail.length} emails on file.` : "No mail besides Calendly.",
    };
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://forge-capital-app.vercel.app",
    },
    body: JSON.stringify({
      model: "x-ai/grok-4.6",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      who: `${meeting.partner_name} · ${firm.firm_name}`,
      firm: firm.thesis_summary || "",
      why_this_call: meeting.title,
      focus: [],
      raise: campaign?.name || "not a raise meeting — inbound / customer / other",
      email_story: text.slice(0, 600),
    };
  }
  try {
    return JSON.parse(m[0]);
  } catch {
    return { who: text.slice(0, 400), firm: "", why_this_call: meeting.title, focus: [], raise: campaign?.name ?? "", email_story: "" };
  }
}

async function main() {
  const weekPath = resolve(ROOT, "data/desk-week.json");
  const week = JSON.parse(readFileSync(weekPath, "utf8"));
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, campaign_intent")
    .eq("status", "active");
  const token = await gmailToken();
  const briefs = {};
  let filed = 0;

  for (const meeting of week.meetings) {
    const emails = (meeting.attendee_emails ?? []).filter((e) => !SELF.has(e.toLowerCase()));
    if (emails.length === 0) continue;
    const email = emails[0].toLowerCase();
    const domain = domainOf(email);
    const firm = await ensureFirm(domain, { name: meeting.firm_name });
    if (!meeting.partner_name) {
      if (/andreas@automat/i.test(email)) meeting.partner_name = "Andreas Cser";
      if (/pkobus@fraser/i.test(email)) meeting.partner_name = "Philipp Kobus";
    }
    const partnerId = await ensurePartner({
      name: meeting.partner_name || email,
      email,
      firm,
    });
    const mail = token ? await searchMail(token, email) : [];
    const campaign = guessRaise(
      [meeting.title, meeting.notes, ...mail.map((m) => `${m.subject} ${m.snippet}`)],
      campaigns ?? [],
    );
    let cpId = null;
    if (campaign) {
      cpId = await ensureCampaignPartner(campaign.id, partnerId, meeting.event_at);
    }
    const brief = await writeBrief({ meeting, firm, partnerId, campaign, mail });
    briefs[meeting.id] = {
      partner_id: partnerId,
      firm_id: firm.id,
      firm_name: firm.firm_name,
      campaign_id: campaign?.id ?? null,
      campaign_name: campaign?.name ?? null,
      campaign_partner_id: cpId,
      correspondence: mail,
      brief,
      generated_at: new Date().toISOString(),
    };
    meeting.partner_id = partnerId;
    meeting.firm_name = firm.firm_name;
    meeting.unmatched = false;
    meeting.campaign_id = campaign?.id ?? null;
    meeting.campaign_name = campaign?.name ?? null;
    filed += 1;
    console.log(
      "filed",
      meeting.partner_name,
      email,
      "→",
      firm.firm_name,
      campaign?.name ?? "no raise",
      `mail=${mail.length}`,
    );
  }

  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(weekPath, JSON.stringify(week, null, 2));
  writeFileSync(resolve(ROOT, "data/meeting-briefs.json"), JSON.stringify(briefs, null, 2));
  console.log(JSON.stringify({ filed, meetings: week.meetings.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
