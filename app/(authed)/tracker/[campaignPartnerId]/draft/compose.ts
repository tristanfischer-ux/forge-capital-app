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

const DEFAULT_SALUTATION_OPEN = "I hope this finds you well. My name is Tristan Fischer.";

// Full sign-off block — verbatim from REAL-TEMPLATES-FROM-GMAIL.md Sample 2
// (FishFrom → Christy / Alabaster, 2026-04-20). This is the canonical
// first-contact sign-off. Never shortened — Rule 3 forbids the truncated
// variant for first contact.
export const SIGN_OFF_BLOCK = [
  "Best wishes,",
  "",
  "Tristan Fischer",
  "+44 7776 191944",
  "tristan.fischer@gmail.com",
  "www.linkedin.com/in/tristanfischer",
].join("\n");

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
function deriveSubject(data: InvestorModalData): string {
  const campaignName = data.campaign?.name ?? "Campaign";
  const pitch = data.campaign?.company_description?.trim();
  if (pitch) {
    const firstClause = pitch.split(/[.;\n]/)[0]?.trim();
    if (firstClause && firstClause.length > 0) {
      const raise = data.campaign?.raise_size?.trim();
      const tail = raise ? ` (${raise})` : "";
      // Keep subject under 90 chars where possible.
      const base = `${campaignName} — ${firstClause}${tail}`;
      return base.length > 140 ? base.slice(0, 137) + "…" : base;
    }
  }
  const raise = data.campaign?.raise_size?.trim();
  return raise ? `${campaignName} (${raise})` : campaignName;
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

function buildCtaBlock(variant: "20min_call" | "presentation_first" | null): string {
  if (variant === "presentation_first") {
    // Matches SkySails / Smedvig sample.
    return "I would be happy to send the investor presentation or arrange a call.";
  }
  // Default: "20min_call" style — matches FishFrom / Alabaster sample.
  return "Would you have 20 minutes for a brief call? I am available early next week.";
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

  // Credibility
  const credibility = template?.credibility_paragraph_full?.trim();
  if (credibility) {
    paragraphs.push(`${DEFAULT_SALUTATION_OPEN} ${credibility}`);
  } else {
    // Honest empty-state: surface the gap, don't fabricate a bio.
    paragraphs.push(
      `${DEFAULT_SALUTATION_OPEN} [Credibility paragraph missing — add one to the email_templates row for this campaign before sending.]`,
    );
  }

  // Company
  const company = template?.company_paragraph?.trim();
  if (company) {
    paragraphs.push(company);
  } else {
    paragraphs.push(
      "[Company paragraph missing — add one to the email_templates row for this campaign before sending.]",
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
    paragraphs.push(
      "[Per-investor synthesis template missing — add one (must open with a Rule-1 hedge) to the email_templates row before sending.]",
    );
  }

  // CTA
  paragraphs.push(buildCtaBlock(template?.cta_variant ?? null));

  // Full clipboard text — subject + blank + Dear + paragraphs + sign-off.
  const salutationLine = firstName ? `Dear ${firstName},` : "Dear [first name],";
  const clipboardSections = [
    `Subject: ${subject}`,
    "",
    salutationLine,
    "",
    paragraphs.join("\n\n"),
    "",
    SIGN_OFF_BLOCK,
  ];

  return {
    subject,
    toEmail: partner?.email ?? null,
    toDisplay,
    firstName,
    bodyParagraphs: paragraphs,
    signOff: SIGN_OFF_BLOCK,
    thesisTooLongToHedge,
    unresolvedPlaceholders,
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
