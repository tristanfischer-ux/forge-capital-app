/**
 * For each raise-mandate approached person, find the latest Gmail sent
 * mail whose subject is that mandate, and whether they replied on that thread.
 * Writes /tmp/gmail-chase-census.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const HINTS = {
  FF: ["FishFrom", "Fish From"],
  SS: ["Space Solar"],
  SK: ["SkySails", "Sky Sails"],
  PA: ["Panatere"],
  OD: ["Odysseus"],
  US: ["US Arbitrage"],
  CA: ["Casper"],
  HO: ["PHANTM", "Hooley"],
};

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

function hdr(headers, name) {
  return (headers || []).find((h) => (h.name || "").toLowerCase() === name.toLowerCase())?.value || "";
}

async function gmailAccess() {
  const r = await fetch(
    env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/gmail_tokens?select=access_token,refresh_token,expires_at&limit=1",
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } },
  );
  const tokens = await r.json();
  let access = tokens[0].access_token;
  if (Date.parse(tokens[0].expires_at) < Date.now() + 60_000) {
    const body = new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: tokens[0].refresh_token,
      grant_type: "refresh_token",
    });
    const tj = await (
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
    ).json();
    if (!tj.access_token) throw new Error("refresh failed " + JSON.stringify(tj).slice(0, 300));
    access = tj.access_token;
  }
  return access;
}

function queryFor(code, email) {
  const hints = (HINTS[code] || [code]).map((h) => `"${h}"`).join(" OR ");
  return `in:sent to:"${email}" subject:(${hints})`;
}

async function gmailJson(access, path) {
  const res = await fetch("https://gmail.googleapis.com" + path, {
    headers: { Authorization: "Bearer " + access },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(path + " " + res.status + " " + JSON.stringify(j).slice(0, 200));
  return j;
}

function isAuto(subject) {
  return /^(auto[- ]?reply|automatic reply|out of office|abwesen|ooo\b|vacation|undeliverable|delivery status)/i.test(
    subject || "",
  );
}

async function inspect(access, email, code) {
  const q = queryFor(code, email);
  const listed = await gmailJson(
    access,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=3`,
  );
  const first = (listed.messages || [])[0];
  if (!first) return { sent: false };
  const msg = await gmailJson(
    access,
    `/gmail/v1/users/me/messages/${first.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
  );
  const h = msg.payload?.headers || [];
  const threadId = msg.threadId;
  const thread = await gmailJson(
    access,
    `/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
  );
  let replied = false;
  let ooo = false;
  for (const m of thread.messages || []) {
    const from = hdr(m.payload?.headers, "From").toLowerCase();
    if (!from.includes(email.toLowerCase())) continue;
    const sub = hdr(m.payload?.headers, "Subject");
    if (isAuto(sub) || /mailer-daemon|postmaster/.test(from)) {
      ooo = true;
      continue;
    }
    replied = true;
    break;
  }
  return {
    sent: true,
    threadId,
    gmailMessageId: msg.id,
    rfcMessageId: hdr(h, "Message-ID"),
    subject: hdr(h, "Subject"),
    sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    replied,
    ooo,
  };
}

const people = JSON.parse(readFileSync("/tmp/raise-approached.json", "utf8"));
const access = await gmailAccess();
const out = [];
let i = 0;
const conc = 6;
for (let n = 0; n < people.length; n += conc) {
  const slice = people.slice(n, n + conc);
  const got = await Promise.all(
    slice.map(async (p) => {
      try {
        const g = await inspect(access, p.email, p.code);
        return { ...p, gmail: g };
      } catch (err) {
        return { ...p, gmail: { sent: false, error: String(err).slice(0, 180) } };
      }
    }),
  );
  out.push(...got);
  i += slice.length;
  if (i % 30 === 0 || i >= people.length) {
    const sent = out.filter((r) => r.gmail?.sent).length;
    const silent = out.filter((r) => r.gmail?.sent && !r.gmail.replied).length;
    process.stdout.write(`  ${i}/${people.length} sent=${sent} silent=${silent}\n`);
  }
}

const summary = {};
for (const code of Object.keys(HINTS)) {
  const rows = out.filter((r) => r.code === code);
  const sent = rows.filter((r) => r.gmail?.sent);
  const silent = sent.filter((r) => !r.gmail.replied && !r.mismatch && r.salutation);
  const replied = sent.filter((r) => r.gmail.replied);
  const noThread = rows.filter((r) => !r.gmail?.sent);
  const mismatch = rows.filter((r) => r.mismatch);
  summary[code] = {
    book: rows.length,
    gmailSent: sent.length,
    silentOk: silent.length,
    replied: replied.length,
    noThread: noThread.length,
    mismatch: mismatch.length,
  };
}
writeFileSync("/tmp/gmail-chase-census.json", JSON.stringify({ summary, rows: out }));
console.log(JSON.stringify(summary, null, 2));
console.log("wrote /tmp/gmail-chase-census.json");
