/**
 * Shared type for the AI drafter on /templates. Lives in a standalone
 * file (not in page.tsx or actions.ts) so both the server action file
 * ("use server" — async-only exports) and the client component can
 * import it without triggering Next.js bundle rules.
 *
 * Maps 1:1 to email_templates columns except `cta` — `cta` writes
 * `cta_variant` (enum: '20min_call' | 'presentation_first') rather than
 * a text column, handled specially by the save action.
 */
export type SectionKind =
  | "credibility_paragraph"
  | "company_paragraph"
  | "intelligent_synthesis_template"
  | "cta";
