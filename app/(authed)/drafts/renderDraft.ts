/**
 * Compose the V4 §8 drafts-panel preview for a single campaign_partner.
 *
 * The full 4-part draft composer lives at
 * `app/(authed)/tracker/[campaignPartnerId]/draft/compose.ts`. The panel
 * here only needs three fields per row (subject / one-line snippet /
 * word-count of the full body), so this helper deliberately does NOT
 * reuse the full-draft composer — that composer requires a richer
 * `InvestorModalData` payload than a +2 row carries.
 *
 * No copy is invented. If the campaign has no template, the snippet
 * surfaces the honest placeholder copy the full composer would surface,
 * so the founder sees the gap before the draft even opens.
 */

export interface RenderDraftInput {
  campaign: {
    name: string;
    company_description: string | null;
    raise_size: string | null;
  };
  template: {
    credibility_paragraph_full: string | null;
    credibility_paragraph_short: string | null;
    company_paragraph: string | null;
    intelligent_synthesis_template: string | null;
    cta_variant: string | null;
  } | null;
  investor: {
    firm_name: string | null;
    thesis_summary: string | null;
    connection_brief: string | null;
  };
}

export interface RenderedDraft {
  /** Subject line, capped at 140 chars to match the tracker pattern. */
  subject: string;
  /** First ~160 chars of the first rendered paragraph. */
  snippet: string;
  /** Full rendered body (newline-separated paragraphs). Used as the
   *  initial value for inline editing on the drafts panel. */
  full_body: string;
  /** Word-count of the full rendered body (not just the snippet). */
  word_count: number;
}

const DEFAULT_SALUTATION_OPEN = "I hope this finds you well. My name is Tristan Fischer.";

/**
 * Derive the subject line. Matches review.ts + compose.ts exactly so a
 * draft seen in the V4 §8 panel is the same draft opened in the tracker
 * draft view. Format: `<Campaign name> — <first clause>` with an
 * optional "(raise_size)" tail.
 */
function deriveSubject(campaign: RenderDraftInput["campaign"]): string {
  const name = campaign.name;
  const pitch = campaign.company_description?.trim();
  if (pitch) {
    const firstClause = pitch.split(/[.;\n]/)[0]?.trim();
    if (firstClause) {
      const raise = campaign.raise_size?.trim();
      const tail = raise ? ` (${raise})` : "";
      const base = `${name} — ${firstClause}${tail}`;
      return base.length > 140 ? base.slice(0, 137) + "…" : base;
    }
  }
  const raise = campaign.raise_size?.trim();
  return raise ? `${name} (${raise})` : name;
}

/**
 * Shorten the source thesis string for the `{{FIRM_THESIS}}` substitution
 * inside `intelligent_synthesis_template`. Matches the behaviour of the
 * full composer — take the first sentence, first two clauses, drop
 * trailing punctuation. Returns null when too long to cleanly hedge.
 */
function shortenThesisForHedge(
  thesisSummary: string | null,
  connectionBrief: string | null,
): string | null {
  const source = (connectionBrief ?? thesisSummary ?? "").trim();
  if (!source) return null;
  const firstSentenceMatch = source.match(/^[^.!?]+[.!?]/);
  const firstSentence = (firstSentenceMatch?.[0] ?? source).trim();
  const clauses = firstSentence
    .split(/[,;—]\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;
  let first = clauses[0]
    .replace(
      /^(the\s+)?(fund|firm|vc|they)\s+(invests?|backs|focuses?)\s+(in|on)\s+/i,
      "",
    )
    .replace(/^(invests?|backs|focuses?)\s+(in|on)\s+/i, "");
  const picked = clauses.length >= 2 ? [first, clauses[1]].join(", ") : first;
  if (picked.length > 260) return null;
  return picked.replace(/[.!?]+$/, "");
}

/**
 * Trim a rendered paragraph into a one-line snippet on a whole-word
 * boundary. Returns the input verbatim if already short enough. Collapses
 * internal whitespace so the snippet is never visually ragged.
 */
function toSnippet(text: string, max = 160): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[,;:.\-]+$/, "") + "…";
}

/**
 * Build the full rendered body (credibility + company + synthesis + CTA)
 * for snippet/word-count purposes. If any paragraph is missing we surface
 * the honest placeholder — same copy the full composer uses — so the
 * panel reflects the real state of the draft.
 */
function renderBody(
  template: RenderDraftInput["template"],
  investor: RenderDraftInput["investor"],
): { paragraphs: string[]; openingLine: string } {
  const paragraphs: string[] = [];
  const firmName = investor.firm_name ?? null;

  // 1. Credibility — prefer the short variant for preview length; fall back
  //    to full if short is missing. The full composer always uses the full
  //    variant, but for a one-line snippet the short variant reads better.
  const credibilityShort = template?.credibility_paragraph_short?.trim();
  const credibilityFull = template?.credibility_paragraph_full?.trim();
  const credibility = credibilityShort || credibilityFull;
  const openingLine = credibility
    ? `${DEFAULT_SALUTATION_OPEN} ${credibility}`
    : `${DEFAULT_SALUTATION_OPEN} [Credibility paragraph missing — add one to the email_templates row before sending.]`;
  paragraphs.push(openingLine);

  // 2. Company paragraph.
  const company = template?.company_paragraph?.trim();
  paragraphs.push(
    company ||
      "[Company paragraph missing — add one to the email_templates row before sending.]",
  );

  // 3. Per-investor synthesis with {{FIRM_NAME}} + {{FIRM_THESIS}} fills.
  // The DB column is still `intelligent_synthesis_template` (named before
  // the "no AI-talk in product" voice rule); the user-visible placeholder
  // below avoids the banned word.
  const synthesisTemplate = template?.intelligent_synthesis_template?.trim();
  if (synthesisTemplate) {
    const shortThesis = shortenThesisForHedge(
      investor.thesis_summary,
      investor.connection_brief,
    );
    let rendered = synthesisTemplate;
    if (firmName) rendered = rendered.replaceAll("{{FIRM_NAME}}", firmName);
    if (shortThesis) rendered = rendered.replaceAll("{{FIRM_THESIS}}", shortThesis);
    paragraphs.push(rendered);
  } else {
    paragraphs.push(
      "[Per-investor synthesis template missing — add one (must open with a Rule-1 hedge) to the email_templates row before sending.]",
    );
  }

  // 4. CTA — mirrors compose.ts `buildCtaBlock`.
  const cta =
    template?.cta_variant === "presentation_first"
      ? "I would be happy to send the investor presentation or arrange a call."
      : "Would you have 20 minutes for a brief call? I am available early next week.";
  paragraphs.push(cta);

  return { paragraphs, openingLine };
}

/**
 * Public entry point — composes subject + snippet + word_count for one
 * +2 Drafted row, ready for the V4 §8 panel.
 */
export function renderDraftForPartner(input: RenderDraftInput): RenderedDraft {
  const subject = deriveSubject(input.campaign);
  const { paragraphs, openingLine } = renderBody(input.template, input.investor);
  const full_body = paragraphs.join("\n\n");
  const word_count = full_body.split(/\s+/).filter(Boolean).length;

  // Snippet is the first paragraph only — matches the V4 mock's "Opening
  // line" column which shows one-line lead copy, not the whole email.
  const snippet = toSnippet(openingLine);

  return { subject, snippet, full_body, word_count };
}
