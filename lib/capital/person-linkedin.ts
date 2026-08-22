import { createCoreClient } from "@/lib/supabase/capital";

export type LinkedInBrief = {
  headline: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  source: "book" | "apollo" | "brave" | "none";
};

function clip(s: string | null | undefined, max = 360): string | null {
  const t = (s ?? "")
    .replace(/&#x27;|&apos;|&#39;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function linkedInFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  return m?.[0] ?? null;
}

async function apolloMatch(opts: {
  email: string | null;
  name: string | null;
  domain: string | null;
  firm: string | null;
}): Promise<{ headline: string | null; title: string | null; url: string | null } | null> {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) return null;
  const [first, ...rest] = (opts.name ?? "").trim().split(/\s+/);
  const last = rest.join(" ") || undefined;
  try {
    const res = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": key,
      },
      body: JSON.stringify({
        email: opts.email || undefined,
        first_name: first || undefined,
        last_name: last,
        organization_name: opts.firm || undefined,
        domain: opts.domain || undefined,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      person?: {
        title?: string;
        headline?: string;
        linkedin_url?: string;
      };
    };
    const p = body.person;
    if (!p) return null;
    return {
      headline: clip(p.headline, 240),
      title: clip(p.title, 120),
      url: p.linkedin_url ?? null,
    };
  } catch {
    return null;
  }
}

async function braveSnippet(
  q: string,
  prefer: string | null,
): Promise<{ snippet: string; url: string | null } | null> {
  const key = process.env.BRAVE_API_KEY?.trim();
  if (!key || q.trim().length < 6) return null;
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", q);
    url.searchParams.set("count", "5");
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      web?: { results?: { title?: string; description?: string; url?: string }[] };
    };
    const hits = (body.web?.results ?? []).filter((r) =>
      /linkedin\.com\/in\//i.test(r.url ?? ""),
    );
    const bits = (prefer ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const hit =
      hits.find((r) => bits.some((b) => `${r.title} ${r.description}`.toLowerCase().includes(b))) ??
      hits[0];
    if (!hit) return null;
    const snippet = clip(
      [hit.title, (hit.description ?? "").replace(/<[^>]+>/g, " ")].filter(Boolean).join(" — "),
      320,
    );
    if (!snippet) return null;
    return { snippet, url: hit.url ?? null };
  } catch {
    return null;
  }
}

export async function linkedInBriefForPerson(opts: {
  personId: string | null;
  name: string | null;
  email: string | null;
  firmName: string | null;
  firmDomain: string | null;
  roleTitle: string | null;
  notes: string | null;
  linkedinUrl?: string | null;
}): Promise<LinkedInBrief> {
  const bookUrl = opts.linkedinUrl || linkedInFromNotes(opts.notes);
  const linkedInNote = (opts.notes ?? "").match(/\[(\d{4}-\d{2}-\d{2}) LinkedIn\]\s*(.+)/);
  if (bookUrl && linkedInNote?.[2]) {
    return {
      headline: clip(linkedInNote[2], 280),
      title: opts.roleTitle,
      url: bookUrl,
      snippet: clip(linkedInNote[2], 280),
      source: "book",
    };
  }

  const apollo = await apolloMatch({
    email: opts.email,
    name: opts.name,
    domain: opts.firmDomain,
    firm: opts.firmName,
  });
  if (apollo?.headline || apollo?.title || apollo?.url) {
    const brief: LinkedInBrief = {
      headline: apollo.headline ?? apollo.title,
      title: apollo.title,
      url: apollo.url ?? bookUrl,
      snippet: [apollo.title, apollo.headline].filter(Boolean).join(" — "),
      source: "apollo",
    };
    if (opts.personId && (apollo.url || apollo.headline)) {
      await persistLinkedIn(opts.personId, brief);
    }
    return brief;
  }

  const q = `site:linkedin.com/in "${opts.name ?? ""}" ${opts.firmName ?? ""}`.trim();
  const brave = await braveSnippet(q, opts.firmName);
  if (brave) {
    const brief: LinkedInBrief = {
      headline: brave.snippet,
      title: opts.roleTitle,
      url: bookUrl ?? brave.url,
      snippet: brave.snippet,
      source: "brave",
    };
    if (opts.personId) await persistLinkedIn(opts.personId, brief);
    return brief;
  }

  if (bookUrl) {
    return {
      headline: opts.roleTitle,
      title: opts.roleTitle,
      url: bookUrl,
      snippet: opts.roleTitle,
      source: "book",
    };
  }
  return {
    headline: null,
    title: opts.roleTitle,
    url: null,
    snippet: null,
    source: "none",
  };
}

async function persistLinkedIn(personId: string, brief: LinkedInBrief) {
  const core = createCoreClient();
  const { data } = await core.from("people").select("notes, linkedin_url").eq("id", personId).maybeSingle();
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp} LinkedIn] ${brief.headline ?? brief.title ?? ""}`.trim();
  const prev = (data?.notes ?? "").trim();
  const next = prev.includes(line) ? prev : `${prev}\n\n${line}`.trim().slice(-8000);
  await core
    .from("people")
    .update({
      linkedin_url: brief.url ?? data?.linkedin_url ?? null,
      notes: next || null,
    })
    .eq("id", personId);
}

export function linkedInBlurb(brief: LinkedInBrief): string {
  if (!brief.headline && !brief.snippet && !brief.url) {
    return "No LinkedIn summary on file.";
  }
  const bits: string[] = [];
  if (brief.headline) bits.push(brief.headline);
  else if (brief.snippet) bits.push(brief.snippet);
  const src =
    brief.source === "apollo"
      ? "Apollo"
      : brief.source === "brave"
        ? "search snippet"
        : "the book";
  bits.push(`Source: ${src}. Not invented.`);
  return bits.join(" ");
}
