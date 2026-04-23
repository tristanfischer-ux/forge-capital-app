import type { InvestorModalData } from "@/lib/queries/investorModal";

/**
 * Compose the 4-part draft email from the campaign's email_template + the
 * partner's investor data. Source of truth for structure:
 *   - Outreach-Writing-Rules-TF.md (Rules 1–9)
 *   - REAL-TEMPLATES-FROM-GMAIL.md (verbatim Gmail samples)
 *
 * The 4 parts are:
 *   1. credibility_paragraph_full      (verbatim from template)
 *   2. company_paragraph               (verbatim from template)
 *   3. intelligent_synthesis_rendered  ({{FIRM_NAME}} + {{FIRM_THESIS}} substituted)
 *   4. cta_block                       (derived from cta_variant)
 *
 * Followed by the sign-off block from REAL-TEMPLATES-FROM-GMAIL.md Sample 2
 * (the canonical full sign-off Tristan uses on first-contact cold mail).
 *
 * No copy is invented here. Where inputs are missing we surface honest
 * placeholders so the reviewer sees what needs fixing before sending.
 */

// Full sign-off block — Rule 12 verbatim from the Outreach Drafting
// Runbook (docs/outreach-drafting-runbook-full-tf.md §5). No phone
// number, no "Best wishes" — the canonical first-contact sign-off uses
// "Best regards," and ends with the full LinkedIn URL including
// protocol and trailing slash. Tristan flagged 2026-04-23 that the 20
// [TEST] emails used "Best wishes," which is off-voice.
export const SIGN_OFF_BLOCK = [
  "Best regards,",
  "",
  "Tristan Fischer",
  "tristan.fischer@gmail.com",
  "https://www.linkedin.com/in/tristanfischer/",
].join("\n");

/**
 * FishFrom-only video link per Rule 5. Linked verbatim from the runbook
 * § 5 Rule 5 — attributed to Andrew Robertson, placed before the
 * 20-minute ask. MUST appear in every FishFrom email; MUST NEVER appear
 * in SkySails, Panatere, or any other campaign.
 */
const FISHFROM_VIDEO_LINK =
  "https://drive.google.com/file/d/1NaBR14yfBOzrS9GiauCRYDEYs6JpBh7O/view";

/**
 * Generate 5 specific calendar slots spread across the next 10 working
 * days, in BST with UTC + CET offsets per runbook §7. Real Google
 * Calendar integration lands in a later pass — for now the slots are
 * deterministic offsets from the current UK date.
 *
 * NOTE: because this is deterministic, every recipient in a batch gets
 * the same 5 slots. That's intentional for V1 (the constraint is
 * Tristan's availability, which is the same regardless of recipient).
 */
function generateCalendarSlots(today = new Date()): string[] {
  const slots: Array<{ daysAhead: number; hour: number; min: number }> = [
    { daysAhead: 2, hour: 10, min: 0 },
    { daysAhead: 4, hour: 15, min: 0 },
    { daysAhead: 5, hour: 9, min: 30 },
    { daysAhead: 8, hour: 14, min: 0 },
    { daysAhead: 10, hour: 11, min: 0 },
  ];

  const toLine = (daysAhead: number, hour: number, min: number): string => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + daysAhead);
    // Skip weekends — bump forward to Monday.
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const dayName = d.toLocaleDateString("en-GB", {
      weekday: "long",
      timeZone: "Europe/London",
    });
    const dateStr = d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/London",
    });
    const pad = (n: number) => n.toString().padStart(2, "0");
    const bst = `${pad(hour)}:${pad(min)}`;
    // BST = UTC+1, CET = UTC+1 (same), BST = CET in summer. But during
    // winter: BST = GMT = UTC; CET = UTC+1. Use BST = UTC+1 as current
    // convention (late April 2026 is already BST).
    const utcHour = hour - 1;
    const cetHour = hour;
    const utc = `${pad(utcHour)}:${pad(min)}`;
    const cet = `${pad(cetHour)}:${pad(min)}`;
    // Bullet character U+2022 matches the v7 TF drafts batch format —
    // Tristan's canonical style guide uses bullets, not hyphens.
    return `  • ${dayName} ${dateStr}, ${bst} BST (${utc} UTC / ${cet} CET)`;
  };

  return slots.map((s) => toLine(s.daysAhead, s.hour, s.min));
}

export interface ComposedDraft {
  /** Subject line — derived from campaign + partner (see deriveSubject). */
  subject: string;
  /** `To:` email. May be null if the partner has no email on file. */
  toEmail: string | null;
  /** `To:` display name. Falls back to email if only address is known. */
  toDisplay: string;
  /** First-name salutation for "Dear X," — best-effort. */
  firstName: string | null;
  /** Fully rendered body paragraphs (no "Dear X," — page prepends that). */
  bodyParagraphs: string[];
  /** The sign-off block — separated so the UI can render it distinctly. */
  signOff: string;
  /** If we couldn't cleanly hedge the thesis, UI shows a review warning. */
  thesisTooLongToHedge: boolean;
  /** Placeholder keys we still see in the rendered synthesis (for warning). */
  unresolvedPlaceholders: string[];
  /**
   * Full email body ready for dispatch — salutation + paragraphs +
   * sign-off, separated by blank lines. This is what Gmail send paths
   * (sendTestBatch, SendGmailMessageButton) should use. Preserves the
   * "Dear Name," greeting and "Best regards, …" that the draft preview
   * page renders. Tristan flagged 2026-04-23 that the test batch was
   * shipping WITHOUT these — fixed by returning this field here so
   * every send path uses the same canonical full body.
   */
  fullBody: string;
  /** Full draft (subject + blank line + body + sign-off) for clipboard. */
  fullClipboardText: string;
}

/**
 * Trim a thesis summary into a short hedged clause suitable for the
 * `{{FIRM_THESIS}}` slot. The template's intelligent_synthesis_template
 * opens with a Rule-1 hedge ("My understanding is that <FIRM> ..."), so
 * the substitution should read naturally after that hedge.
 *
 * Rule: at most 2 clauses, split on commas / em-dashes / semicolons. If the
 * thesis is absent or too long to cleanly compress, we return null so the
 * caller can surface a "review manually" warning rather than silently
 * producing a malformed sentence.
 */
function shortenThesisForHedge(
  thesisSummary: string | null,
  connectionBrief: string | null,
): { text: string | null; tooLong: boolean } {
  // thesis_summary FIRST — it is the actual thesis phrase (e.g. "Pioneered
  // 'SpaceTech' as an investment category..."). connection_brief is a
  // research-sourcing disclosure ("X is publicly visible through multiple
  // channels...") which is NOT a thesis. Fixed 2026-04-23 after the audit
  // email to Christophe read "focuses primarily on Seraphim is publicly
  // visible through multiple channels..." — grammatically broken because
  // connection_brief was being substituted into the template as a thesis.
  const source = (thesisSummary ?? connectionBrief ?? "").trim();
  if (!source) return { text: null, tooLong: false };

  // Grab the first sentence.
  const firstSentenceMatch = source.match(/^[^.!?]+[.!?]/);
  const firstSentence = (firstSentenceMatch?.[0] ?? source).trim();

  // Split into clauses on commas / em-dash / semicolons.
  const clauses = firstSentence
    .split(/[,;—]\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) return { text: null, tooLong: false };

  // Take up to 2 clauses. Strip leading "X invests in " / "X backs " / etc.
  // patterns from the first clause — the template already supplies the
  // "invests in / backs" hedge, so avoid double-verbing.
  let first = clauses[0]
    .replace(
      /^(the\s+)?(fund|firm|firm|vc|they)\s+(invests?|backs|focuses?)\s+(in|on)\s+/i,
      "",
    )
    .replace(/^(invests?|backs|focuses?)\s+(in|on)\s+/i, "");

  // If the first clause already starts with a firm name (proper noun + verb),
  // keep as-is. Else keep first 2 clauses joined by ", " for a natural read.
  const picked =
    clauses.length >= 2 ? [first, clauses[1]].join(", ") : first;

  const tooLong = picked.length > 260;
  if (tooLong) return { text: null, tooLong: true };
  // Drop trailing punctuation — the template likely wraps in a larger sentence.
  return { text: picked.replace(/[.!?]+$/, ""), tooLong: false };
}

/**
 * Extract the first name from a `name` column that may be "Andy Ruben" or
 * "Dr. Markus Weiss". Returns null if we can't safely guess.
 */
function firstNameFrom(full: string | null): string | null {
  if (!full) return null;
  const cleaned = full.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?)\s+/i, "").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  return parts[0] ?? null;
}

/**
 * Derive a subject line in the shape
 *   `<Campaign name> — <short pitch>`
 *
 * If the campaign has a `company_description`, use its first clause; else
 * fall back to the campaign name alone. Rule 2 wants subject variation per
 * recipient — that's a future enhancement (thesis-aware subject selector).
 * V1 uses one campaign-level subject.
 */
/**
 * Rule 2 per-recipient angle. 2-5 words pulled from sector_focus or
 * the first clause of thesis_summary, used as the trailing parenthetical
 * on the subject so each recipient gets a tailored subject line rather
 * than an identical one across the batch. Examples from the runbook:
 *   "SkySails Power — airborne wind energy, €5M Series A bridge (Flying Whales / hydrogen CVC)"
 *   "SkySails Power — airborne wind energy, €5M Series A bridge (DACH deep-tech hardware)"
 */
function deriveRecipientAngle(data: InvestorModalData): string | null {
  // Priority 1: Opus-generated cached subject_angle on campaign_partners.
  // Written by refineSynthesisWithOpus alongside rendered_synthesis.
  // 2-5 words, insightful per-firm, matches Tristan's v7 TF style.
  const cached = data.subject_angle?.trim();
  if (cached) return cached;

  // Fallback: raw sector_focus. Used only when Opus hasn't run — the
  // test-send batch pre-runs Opus for every row so this branch rarely
  // ships to an inbox.
  const sector = data.investor.sector_focus?.trim();
  if (sector && sector.length > 0 && sector.length < 70) {
    return sector;
  }
  const thesis = data.investor.thesis_summary?.trim();
  if (thesis) {
    const firstSentence = thesis.split(/[.!?]/)[0];
    const clauses = firstSentence.split(/[,;—]/).map((c) => c.trim()).filter(Boolean);
    const pick = clauses.slice(0, 2).join(" / ");
    if (pick.length > 0 && pick.length < 70) return pick;
    if (pick.length >= 70) return pick.slice(0, 60).replace(/\s+\S*$/, "") + "…";
  }
  const geo = data.investor.geo_focus?.trim();
  if (geo && geo.length < 50) return geo;
  return null;
}

function deriveSubject(data: InvestorModalData): string {
  const campaignName = data.campaign?.name ?? "Campaign";
  // Strip internal prefixes ("AUDIT · ") and workstream suffixes
  // ("· Investor") so the subject reads as the company name, not the
  // tracker filename.
  const displayName = campaignName
    .replace(/^audit\s*[·|:]?\s*/i, "")
    .replace(/\s*[·|]\s*(investor|customer|supplier)\s*$/i, "")
    .trim();

  const pitch = data.campaign?.company_description?.trim();
  const raise = data.campaign?.raise_size?.trim();
  const raiseTail = raise ? `, ${raise}` : "";
  const angle = deriveRecipientAngle(data);
  const angleTail = angle ? ` (${angle})` : "";

  // Subject format per runbook §9 — Rule 2:
  //   <Display name> — <short pitch><, raise size> (<per-recipient angle>)
  let head: string;
  if (pitch) {
    const firstClause = pitch.split(/[.;\n]/)[0]?.trim();
    if (firstClause && firstClause.length > 0) {
      const clauseStartsWithName = firstClause
        .toLowerCase()
        .startsWith(displayName.toLowerCase());
      head = clauseStartsWithName
        ? `${firstClause}${raiseTail}`
        : `${displayName} — ${firstClause}${raiseTail}`;
    } else {
      head = `${displayName}${raiseTail}`;
    }
  } else {
    head = `${displayName}${raiseTail}`;
  }

  const full = `${head}${angleTail}`;
  return full.length > 160 ? full.slice(0, 157) + "…" : full;
}

/**
 * Render the intelligent synthesis template with {{FIRM_NAME}} + {{FIRM_THESIS}}
 * substitutions. Returns both the rendered text and the list of placeholders
 * that could not be resolved (so the UI can warn Tristan to edit manually).
 */
function renderSynthesis(
  template: string,
  firmName: string | null,
  firmThesis: string | null,
): { rendered: string; unresolved: string[] } {
  let out = template;
  const unresolved: string[] = [];

  if (firmName) {
    out = out.replaceAll("{{FIRM_NAME}}", firmName);
  } else if (out.includes("{{FIRM_NAME}}")) {
    unresolved.push("{{FIRM_NAME}}");
  }

  if (firmThesis) {
    out = out.replaceAll("{{FIRM_THESIS}}", firmThesis);
  } else if (out.includes("{{FIRM_THESIS}}")) {
    unresolved.push("{{FIRM_THESIS}}");
  }

  return { rendered: out, unresolved };
}

function buildCtaBlock(
  variant: "20min_call" | "presentation_first" | null,
): string {
  const slotLines = generateCalendarSlots();
  const intro =
    variant === "presentation_first"
      ? "I would be happy to send the investor presentation or arrange a call. Would any of the following 30-minute slots work?"
      : "Would any of the following 30-minute slots work for a call? I am in UK time (BST, UTC+1). If none of these work I will happily suggest others.";
  return [intro, "", ...slotLines].join("\n");
}

export function composeDraft(data: InvestorModalData): ComposedDraft {
  const template = data.email_template;
  const partner = data.primary_partner;
  const firmName = data.investor.firm_name ?? null;

  const firstName = firstNameFrom(partner?.name ?? null);
  const toDisplay = partner?.name ?? partner?.email ?? "—";

  const subject = deriveSubject(data);

  // Body assembly — four paragraphs per REAL-TEMPLATES-FROM-GMAIL.md.
  const paragraphs: string[] = [];
  const unresolvedPlaceholders: string[] = [];
  let thesisTooLongToHedge = false;

  // Credibility — Rule 3 verbatim bio. Fallback order:
  //   1. email_templates.credibility_paragraph_full (Opus-drafted, approved)
  //   2. campaigns.founder_bio (the raw bio saved on the Voice Reference card)
  // This lets sends work out of the box on any campaign with a
  // founder_bio, even if the /templates UI has never been visited.
  const credibility =
    template?.credibility_paragraph_full?.trim() ||
    data.campaign?.founder_bio?.trim() ||
    null;
  if (credibility) {
    paragraphs.push(credibility);
  } else {
    paragraphs.push(
      "[Credibility paragraph missing — edit the founder bio on /templates before sending.]",
    );
  }

  // Company — fallback to campaigns.company_description when the
  // Opus-drafted company_paragraph on email_templates is not set.
  const company =
    template?.company_paragraph?.trim() ||
    data.campaign?.company_description?.trim() ||
    null;
  if (company) {
    paragraphs.push(company);
  } else {
    paragraphs.push(
      "[Company paragraph missing — edit the company description on /templates before sending.]",
    );
  }

  // Intelligent synthesis (with hedge).
  //
  // Preference order:
  //   1. `rendered_synthesis` on the campaign_partners row — Opus has
  //      already produced a grammatical per-investor paragraph. Use
  //      verbatim. This is what the "Refine synthesis with Opus" button
  //      writes after the 2026-04-23 verb-chain stumble.
  //   2. Otherwise, fall back to template-token substitution with the
  //      same shortenThesisForHedge compression as before. Known to
  //      stumble on verb-leading theses ("focuses primarily on Pioneered
  //      SpaceTech..."); the Regenerate button fixes those one at a time.
  const rendered = data.rendered_synthesis?.trim();
  const synthesisTemplate = template?.intelligent_synthesis_template?.trim();
  if (rendered) {
    paragraphs.push(rendered);
  } else if (synthesisTemplate) {
    const { text: shortThesis, tooLong } = shortenThesisForHedge(
      data.investor.thesis_summary,
      data.investor.connection_brief,
    );
    thesisTooLongToHedge = tooLong;
    const { rendered: substituted, unresolved } = renderSynthesis(
      synthesisTemplate,
      firmName,
      shortThesis,
    );
    paragraphs.push(substituted);
    unresolvedPlaceholders.push(...unresolved);
  } else {
    // Honest non-bracketed signal — brackets are banned anywhere in
    // rendered body text. The preview page surfaces this as a review
    // warning; real sends go through sendTestBatch which pre-generates
    // rendered_synthesis via Opus, so this branch never actually ships
    // to an inbox.
    paragraphs.push(
      "Per-investor synthesis not yet generated. Click Refine synthesis with Opus below before sending.",
    );
    unresolvedPlaceholders.push("synthesis");
  }

  // Rule 5 — FishFrom video link (FishFrom-only, ALWAYS present on
  // FishFrom, NEVER on any other campaign). Detected by campaign name
  // containing "FishFrom" case-insensitively. The drafted composer
  // output is never shown to non-FishFrom recipients.
  const campaignName = data.campaign?.name ?? "";
  const isFishFrom = /fishfrom/i.test(campaignName);
  if (isFishFrom) {
    paragraphs.push(
      `There is a short video of the FishFrom platform and founder Andrew Robertson here — it gives a better sense of the technology than a deck: ${FISHFROM_VIDEO_LINK}`,
    );
  }

  // Low-confidence escape-hatch per runbook §5 Rule 10. When the
  // per-investor synthesis stumbled (thesisTooLongToHedge, or unresolved
  // {{FIRM_THESIS}} placeholder), prepend an "if I have misread the fit
  // here, I would welcome the correction" sentence so the reader can
  // correct Tristan without feeling spammed.
  const lowConfidence =
    thesisTooLongToHedge || unresolvedPlaceholders.length > 0;
  if (lowConfidence) {
    paragraphs.push(
      "If I have misread the fit here, I would welcome the correction.",
    );
  }

  // Rule 10 §6 — the 20-minute ask with 3-5 specific slots.
  paragraphs.push(buildCtaBlock(template?.cta_variant ?? null));

  // Full clipboard text — subject + blank + Dear + paragraphs + sign-off.
  // Salutation — prefer first name; when missing, fall back to
  // "Hello," rather than a bracketed "[first name]" placeholder which
  // would violate the bracket-ban and ship to a recipient.
  const salutationLine = firstName ? `Dear ${firstName},` : "Hello,";
  const clipboardSections = [
    `Subject: ${subject}`,
    "",
    salutationLine,
    "",
    paragraphs.join("\n\n"),
    "",
    SIGN_OFF_BLOCK,
  ];

  // fullBody — the canonical rendered email body for dispatch paths.
  // Matches what the preview page renders: salutation, blank line,
  // paragraphs separated by blank lines, blank line, sign-off.
  const fullBody = [
    salutationLine,
    "",
    paragraphs.join("\n\n"),
    "",
    SIGN_OFF_BLOCK,
  ].join("\n");

  return {
    subject,
    toEmail: partner?.email ?? null,
    toDisplay,
    firstName,
    bodyParagraphs: paragraphs,
    signOff: SIGN_OFF_BLOCK,
    thesisTooLongToHedge,
    unresolvedPlaceholders,
    fullBody,
    fullClipboardText: clipboardSections.join("\n"),
  };
}

/**
 * Determine whether the draft may be copied to Gmail. Blocking tiers are
 * `generic_blocked`, `bounced`, `unverified` — only `corresponded` or
 * `hunter_verified` (or an explicit null tier with an email on file, which
 * we block-with-warning) advance to +2 Drafted.
 */
export function isTierBlocked(
  tier: NonNullable<InvestorModalData["primary_partner"]>["email_tier"] | null,
): boolean {
  return tier === "generic_blocked" || tier === "bounced" || tier === "unverified";
}
