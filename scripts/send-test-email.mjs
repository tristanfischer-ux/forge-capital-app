#!/usr/bin/env node
/**
 * Audit re-send 2026-04-23 — fixes two bugs from the first send:
 *
 * 1. Subject line garbled in Mac Mail. Cause: UTF-8 middle-dot char (·)
 *    was put in the Subject header without RFC 2047 encoded-word
 *    wrapping; mail clients read its UTF-8 bytes as Latin-1 → mojibake
 *    (Ã,Â·). Fix: use plain ASCII subject only.
 *
 * 2. Body tone was generic. Tristan: tone should be "who I am, what
 *    the company is, an understanding of what the investor does based
 *    on the semantic search". Fix: call Haiku with the investor's
 *    actual synthesis prose (investment_pattern + thesis_summary +
 *    team_expertise) as context, ask for an email matching that
 *    structure.
 *
 * Usage: node scripts/send-test-email.mjs
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
  } catch {}
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !ANTHROPIC_API_KEY) {
  console.error("[send] missing env");
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function refreshAccessToken(tokenRow) {
  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: tokenRow.refresh_token,
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

async function haikuComposeBody({ apiKey, investor, founderName, companyOneLine, raise }) {
  const system =
    "You write founder-to-investor introduction emails. Voice: Tristan Fischer's — first-person, British spelling, specific over abstract, NO acronyms (spell every term out, including 'high-altitude platform stations' not 'HAPS'), NO 'AI-powered' / 'Smart' / 'Intelligent' marketing verbs. Concise: 4 short paragraphs. Sign 'Tristan — Founder, Fractional Forge'. Output ONLY the email body — no subject, no salutation prefix beyond the actual greeting line, no boilerplate.";
  const user = [
    "Compose an investor introduction email with this exact structure:",
    "",
    "Paragraph 1 — Who I am: Tristan, Fractional Forge, helping the founder team raise their round. Mention I am writing on behalf of the company.",
    "",
    "Paragraph 2 — The company in one sentence: " + companyOneLine,
    "",
    "Paragraph 3 — Why this investor specifically. Reference 1-2 specific things from their thesis below — the SAR/Earth observation focus, the stage range, named portfolio companies, etc. This paragraph is the demonstration of homework. Do NOT name the partner directly here; this paragraph is about the FIRM.",
    "",
    "Paragraph 4 — The ask: 20 minutes to walk through the platform; we are raising " + raise + ". One clear next step.",
    "",
    "INVESTOR FIRM: " + investor.firm_name,
    "INVESTOR THESIS: " + (investor.thesis_summary ?? ""),
    "INVESTOR INVESTMENT PATTERN: " + (investor.investment_pattern ?? ""),
    "INVESTOR TEAM: " + (investor.team_expertise ?? ""),
    "",
    "FOUNDER WRITING THE EMAIL: " + founderName,
    "",
    "Greet the contact (Lewis Jones, Investment Principal at Seraphim) by first name in the opening salutation.",
    "",
    "Output the email body only.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    }),
  });
  if (!res.ok) throw new Error(`haiku ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const body = await res.json();
  const text = body.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text;
}

(async () => {
  const { data: tokens } = await sb.from("gmail_tokens").select("user_id, refresh_token, scope").limit(1);
  if (!tokens || tokens.length === 0) {
    console.error("[send] no gmail_tokens");
    process.exit(1);
  }
  const accessToken = await refreshAccessToken(tokens[0]);
  console.log("[send] token refreshed");

  // Pull Seraphim's actual synthesis from Supabase.
  const { data: investorRows, error: invErr } = await sb
    .from("investors_mirror")
    .select("firm_name, thesis_summary, investment_pattern, team_expertise")
    .eq("id", 2359)
    .limit(1);
  if (invErr || !investorRows || investorRows.length === 0) {
    console.error("[send] investor lookup failed");
    process.exit(1);
  }
  const investor = investorRows[0];
  console.log("[send] composing body via Haiku for " + investor.firm_name);

  const composedBody = await haikuComposeBody({
    apiKey: ANTHROPIC_API_KEY,
    investor,
    founderName: "Tristan Fischer (introducing Wren Aerospace's CEO)",
    companyOneLine:
      "Wren Aerospace is a Dutch startup, incubated at the European Space Agency Business Incubation Centre in Noordwijk, building the Wren Flyer — a hydrogen-and-solar hybrid aircraft that operates at 20 kilometres altitude in the stratosphere to provide persistent connectivity, Earth observation and emergency communications.",
    raise: "between 1.5 and 3 million euros at Pre-Seed / Seed",
  });

  console.log("[send] body composed (" + composedBody.length + " chars)");

  // Plain ASCII subject — no middle-dots, no en-dashes. Safe for any client.
  const to = "tristan.fischer@mac.com";
  const subject = "Wren Aerospace - stratospheric drone introduction (audit-test from Forge Capital)";

  const rawHeaders = [
    "To: " + to,
    "Subject: " + subject,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
  ];
  const rawMessage = rawHeaders.join("\r\n") + "\r\n\r\n" + composedBody;
  const encoded = base64UrlEncode(Buffer.from(rawMessage, "utf8"));

  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    },
  );
  if (!sendRes.ok) {
    console.error("[send] FAILED " + sendRes.status + ": " + (await sendRes.text()).slice(0, 500));
    process.exit(1);
  }
  const sendBody = await sendRes.json();
  console.log("[send] OK — gmail message id " + sendBody.id);
  console.log("[send] sent to " + to);
  console.log("\n--- composed body ---\n" + composedBody + "\n---\n");
})().catch((err) => {
  console.error("[send] fatal:", err);
  process.exit(1);
});
