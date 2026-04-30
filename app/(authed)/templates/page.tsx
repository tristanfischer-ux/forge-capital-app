import Link from "next/link";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
  type CampaignSummary,
} from "@/lib/queries/campaigns";
import {
  getCampaignTemplates,
  type CampaignTemplate,
} from "@/lib/queries/templates";
import { createServerClient } from "@/lib/supabase/server";
import { AiSectionDrafter } from "./AiSectionDrafter";
import VoiceReferenceCard from "./VoiceReferenceCard";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import { DuplicateTemplateButton } from "./DuplicateTemplateButton";
import type { SectionKind } from "./types";

/**
 * Templates page — V4 §6 "Email draft writer — two shapes, one archetype picks"
 * (Phase2-Mockup-V4.html lines 1448–1523).
 *
 * V4 classes used verbatim (from app/v4-mockup.css):
 *   - `.section` / `.section-head` / `.section-title` / `.section-sub`
 *     / `.section-link`
 *   - `.templates-grid` (2-col on desktop, collapses to 1-col at ≤1100px)
 *   - `.template-card` / `.template-head` (`.inv` | `.sup`)
 *     / `.th-ico` / `.th-title` / `.th-shape`
 *   - `.template-body` / `.tb-from` / `.tb-subj` / `.tb-para` / `.tb-var`
 *     (`.amber` variant on the supplier side)
 *   - `.template-foot`
 *   - `.template-anno` / `.ta-n`
 *   - `.batch-drafted-strip` / `.bds-ico` / `.btn.primary`
 *
 * The two columns map to Tristan's archetype families:
 *   - Left:  Asking-for-money   (investor + customer campaigns)
 *   - Right: Offering-money     (supplier campaigns)
 *
 * The active campaign populates whichever column matches its
 * `campaign_intent`. The opposing column renders an honest greyed
 * placeholder — no invented copy (Outreach-Writing-Rules-TF.md Rule 5).
 *
 * `Edit` is V2 — V1 renders a disabled button with a tooltip.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ c?: string }>;

export default async function TemplatesPage({
  searchParams,
  initialCampaigns,
  initialCampaignId,
}: {
  searchParams: SearchParams;
  /** Optional pre-fetched campaigns list (passed by /home composer to
   *  avoid re-running `listActiveCampaigns()` 7× per render). When
   *  omitted — e.g. direct navigation to /templates — we fetch as before. */
  initialCampaigns?: CampaignSummary[];
  /** Optional pre-resolved active campaign id (same rationale). */
  initialCampaignId?: string | null;
}) {
  const { c } = await searchParams;

  let campaigns: CampaignSummary[];
  let campaignId: string | null;
  if (initialCampaigns !== undefined) {
    campaigns = initialCampaigns;
    campaignId = initialCampaignId ?? null;
  } else {
    campaigns = await listActiveCampaigns();
    campaignId = resolveCurrentCampaignId(campaigns, c);
  }

  if (!campaignId) {
    return (
      <div className="mx-auto max-w-2xl rounded-[10px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
        <h1 className="mb-2 text-lg font-semibold text-text">
          No campaigns available
        </h1>
        <p className="text-[13px] text-text-dim">
          Sign in to load templates. Row-level security gates every
          table until an authenticated session is present.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center rounded-[8px] bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-dark"
        >
          Go to sign-in
        </Link>
      </div>
    );
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const { askingForMoney, offeringMoney } = await getCampaignTemplates(campaignId);

  // Fetch the voice-reference fields for the active campaign so the
  // editor card renders with the current values. Done inline here to
  // avoid expanding CampaignSummary (which is used everywhere and does
  // not need the long bio/reference text on every page).
  const voiceRefSupabase = await createServerClient();
  const { data: voiceRefRow } = await voiceRefSupabase
    .from("campaigns")
    .select("founder_bio, voice_reference_email")
    .eq("id", campaignId)
    .maybeSingle();
  const founderBio =
    (voiceRefRow as { founder_bio?: string | null } | null)?.founder_bio ?? null;
  const voiceReferenceEmail =
    (voiceRefRow as { voice_reference_email?: string | null } | null)
      ?.voice_reference_email ?? null;

  // The archetype of the active campaign determines which column is
  // rendered. Tristan's campaign_intent:
  //   investor | customer → asking-for-money
  //   supplier            → offering-money
  //
  // Enhancement 2026-04-22 (UI-B): the OPPOSING archetype column used to
  // render as a greyed placeholder. We now skip it entirely — founders
  // only ever work in one archetype per campaign, and rendering both
  // sides added visual noise plus an always-stale placeholder that
  // suggested work that wasn't needed.
  const activeArchetype: "asking-for-money" | "offering-money" | null =
    activeCampaign
      ? activeCampaign.campaign_intent === "supplier"
        ? "offering-money"
        : "asking-for-money"
      : null;

  const activeSide: "asking" | "offering" | null =
    activeArchetype === "offering-money" ? "offering" : activeArchetype ? "asking" : null;
  const activeTemplate: CampaignTemplate | null =
    activeSide === "offering" ? offeringMoney : activeSide === "asking" ? askingForMoney : null;

  // The drafter falls back to an honest error in the UI when the key is
  // absent (per the action contract) — this flag just lets us hide the
  // button entirely when we already know it won't work.
  const hasAnthropicKey = Boolean(process.env.OPENROUTER_API_KEY);

  return (
    <section id="templates" className="section" style={{ marginTop: 0 }}>
      {/* V4 lines 1449–1455 — section head, subtitle, right-side link. */}
      <div className="section-head">
        <div>
          <div className="section-title">
            Email draft writer &mdash; two shapes, one archetype picks
            {activeCampaign ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · "}
                {activeCampaign.name}
              </span>
            ) : null}
          </div>
          <div className="section-sub">
            Asking-for-money emails (Investor + Customer) open with a relevance
            hook and close with an ask. Offering-money emails (Supplier) open
            with the requirement and close with a quick-qualify. The archetype
            you picked on the campaign row decides which.
          </div>
        </div>
        <span className="section-link">See all 6 template slots &rarr;</span>
      </div>

      {/* Voice reference card — edits founder_bio + voice_reference_email
          on this campaign. Opus reads both when drafting. */}
      {activeCampaign ? (
        <VoiceReferenceCard
          campaignId={activeCampaign.id}
          campaignName={activeCampaign.name}
          initialFounderBio={founderBio}
          initialVoiceReferenceEmail={voiceReferenceEmail}
        />
      ) : null}

      {/* Enhancement 2026-04-22 (UI-B): single-column grid — only the active
          archetype is rendered. The opposite archetype is hidden entirely
          (not greyed) because founders only ever work in one archetype per
          campaign. Grid wrapper retained for V4 class parity + future
          hybrid-campaign support. */}
      <div className="templates-grid" style={{ gridTemplateColumns: "1fr" }}>
        {activeSide ? (
          <TemplateColumn
            side={activeSide}
            template={activeTemplate}
            activeCampaignName={activeCampaign?.name ?? null}
            activeCampaignId={activeCampaign?.id ?? null}
            hasAnthropicKey={hasAnthropicKey}
          />
        ) : (
          <div
            className="template-card"
            style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}
          >
            No active campaign selected — pick one from the campaign switcher
            to see its template.
          </div>
        )}
      </div>

      {/* V4 lines 1517–1522 — batch-drafted-strip footer. V1 keeps it as
          copy only (no live batch yet); the link anchor to #review lands
          when the Review section ports. */}
      <div className="batch-drafted-strip">
        <span className="bds-ico">&#10003;</span>
        <div>
          Drafts are composed per partner from this template plus the
          investor modal data. Variables like firm name and thesis are
          resolved at draft time &mdash; see a rendered example on any
          approved tracker row.
        </div>
        <span className="spacer" />
        <Link
          href="/tracker"
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          Go to tracker &rarr;
        </Link>
      </div>
    </section>
  );
}

/**
 * One column of the templates grid. Renders the V4 `.template-card`
 * chrome verbatim, with the 4 parts (credibility / company / intelligent
 * synthesis / CTA) labelled inside `.template-body`.
 *
 * `side` controls the `.template-head` colour variant and iconography:
 *   - `asking`   → `.inv` (indigo gradient, 'I' icon)
 *   - `offering` → `.sup` (amber gradient, 'S' icon)
 *
 * When `template` is null AND this side doesn't match the active
 * campaign's archetype, we render a greyed placeholder explaining
 * which archetype lives here — we don't invent copy.
 */
function TemplateColumn({
  side,
  template,
  activeCampaignName,
  activeCampaignId,
  hasAnthropicKey,
}: {
  side: "asking" | "offering";
  template: CampaignTemplate | null;
  activeCampaignName: string | null;
  activeCampaignId: string | null;
  hasAnthropicKey: boolean;
}) {
  const isAsking = side === "asking";
  const headClass = isAsking ? "template-head inv" : "template-head sup";
  const icoLetter = isAsking ? "I" : "S";
  const title = isAsking
    ? "Asking-for-money — Investor / Customer"
    : "Offering-money — Supplier";
  const shape = isAsking
    ? "Hook → Evidence → Ask"
    : "Requirement → Capability check → Quick-qualify";

  return (
    <div className="template-card">
      <div className={headClass}>
        <span className="th-ico">{icoLetter}</span>
        <span className="th-title">{title}</span>
        <span className="th-shape">{shape}</span>
      </div>

      {template ? (
        <PopulatedBody
          template={template}
          side={side}
          activeCampaignId={activeCampaignId}
          hasAnthropicKey={hasAnthropicKey}
        />
      ) : (
        <MissingTemplateBody
          side={side}
          activeCampaignName={activeCampaignName}
          activeCampaignId={activeCampaignId}
          hasAnthropicKey={hasAnthropicKey}
        />
      )}

      <TemplateFoot
        template={template}
        side={side}
        activeCampaignId={activeCampaignId}
      />
    </div>
  );
}

/** Render the 4 labelled parts from a real `email_templates` row. */
function PopulatedBody({
  template,
  side,
  activeCampaignId,
  hasAnthropicKey,
}: {
  template: CampaignTemplate;
  side: "asking" | "offering";
  activeCampaignId: string | null;
  hasAnthropicKey: boolean;
}) {
  const varClass = side === "asking" ? "tb-var" : "tb-var amber";

  // Credibility: prefer the full variant (Rule 3 says first-contact uses
  // full bio). Fall back to short if only short is present.
  const credibility =
    template.credibility_paragraph_full ??
    template.credibility_paragraph_short ??
    null;

  const cta = ctaCopyFor(template.cta_variant);

  return (
    <div className="template-body">
      <div className="tb-from">
        <b>Campaign</b> {template.campaign_name} &middot;{" "}
        <b>Template</b>{" "}
        <span className={varClass}>
          {template.template_name ?? "(unnamed)"}
        </span>
        {template.captured_at ? (
          <>
            {" "}
            &middot; <b>Captured</b>{" "}
            {new Date(template.captured_at).toISOString().slice(0, 10)}
          </>
        ) : null}
      </div>

      <Part
        label="1. Credibility paragraph"
        body={credibility}
        kind="prose"
        sectionKind="credibility_paragraph"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="2. Company paragraph"
        body={template.company_paragraph}
        kind="prose"
        sectionKind="company_paragraph"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="3. Per-investor synthesis"
        body={template.intelligent_synthesis_template}
        kind="synthesis"
        varClass={varClass}
        sectionKind="intelligent_synthesis_template"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="4. Call to action"
        body={cta.body}
        kind="cta"
        ctaMeta={cta.meta}
        sectionKind="cta"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
    </div>
  );
}

/** Render one of the 4 labelled parts of the body. */
function Part({
  label,
  body,
  kind,
  varClass,
  ctaMeta,
  sectionKind,
  campaignId,
  hasAnthropicKey,
  side,
}: {
  label: string;
  body: string | null;
  kind: "prose" | "synthesis" | "cta";
  varClass?: string;
  ctaMeta?: string;
  sectionKind: SectionKind;
  campaignId: string | null;
  hasAnthropicKey: boolean;
  side: "asking" | "offering";
}) {
  const isTodo =
    typeof body === "string" && body.trim().toLowerCase().startsWith("todo");

  return (
    <div
      className="tb-para"
      style={{
        borderLeft: "2px solid var(--border-soft)",
        paddingLeft: 10,
        marginBottom: 12,
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{label}</span>
        {campaignId ? (
          <AiSectionDrafter
            sectionKind={sectionKind}
            campaignId={campaignId}
            existingBody={body}
            hasAnthropicKey={hasAnthropicKey}
            side={side}
          />
        ) : null}
      </div>
      {body === null || body.trim() === "" ? (
        <EmptyPart
          note={
            kind === "cta"
              ? "CTA variant not set on this template."
              : "Not captured yet."
          }
        />
      ) : isTodo ? (
        <TodoPart body={body} />
      ) : kind === "synthesis" ? (
        <SynthesisBody body={body} varClass={varClass ?? "tb-var"} />
      ) : (
        <ProseBody body={body} />
      )}
      {kind === "cta" && ctaMeta ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          {ctaMeta}
        </div>
      ) : null}
    </div>
  );
}


/**
 * Render a prose paragraph with hard newlines preserved. DB paragraphs
 * sometimes contain `\n\n` for multi-paragraph company blocks (see the
 * FishFrom seed row) — split on blank lines so they render correctly.
 */
function ProseBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/g);
  return (
    <div>
      {blocks.map((b, i) => (
        <div
          key={i}
          style={{ marginBottom: i < blocks.length - 1 ? 8 : 0, whiteSpace: "pre-wrap" }}
        >
          {b}
        </div>
      ))}
    </div>
  );
}

/**
 * Render the intelligent-synthesis paragraph with `{{FIRM_NAME}}` and
 * `{{FIRM_THESIS}}` highlighted via the V4 `.tb-var` pill. Unknown
 * placeholders (`{{FOO}}`) are shown as-is so we see what still needs
 * wiring.
 */
function SynthesisBody({ body, varClass }: { body: string; varClass: string }) {
  const parts = body.split(/(\{\{[A-Z_]+\}\})/g);
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        if (/^\{\{[A-Z_]+\}\}$/.test(p)) {
          return (
            <span key={i} className={varClass}>
              {p}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

/**
 * Render a TODO placeholder honestly. Tristan's seed file uses
 * "TODO: needs capture from Gmail" for Panatere / ForgeOS / Fischer Farms
 * Customer. We render it as-is (Rule 5) with a warning chip so the
 * reader sees the debt.
 */
function TodoPart({ body }: { body: string }) {
  return (
    <div>
      <span
        style={{
          display: "inline-block",
          padding: "1px 7px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 600,
          background: "var(--amber-light)",
          color: "var(--amber)",
          border: "1px solid #fde68a",
          marginRight: 8,
        }}
      >
        TODO
      </span>
      <span style={{ color: "var(--text-dim)", whiteSpace: "pre-wrap" }}>
        {body}
      </span>
    </div>
  );
}

function EmptyPart({ note }: { note: string }) {
  return (
    <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
      {note}
    </span>
  );
}

/**
 * Body shown when the active archetype has no captured template yet.
 * Every section ships with a "Draft with Haiku →" button so Tristan can
 * seed the template from the page — no need to hand-edit Supabase.
 */
function MissingTemplateBody({
  side,
  activeCampaignName,
  activeCampaignId,
  hasAnthropicKey,
}: {
  side: "asking" | "offering";
  activeCampaignName: string | null;
  activeCampaignId: string | null;
  hasAnthropicKey: boolean;
}) {
  const sideLabel =
    side === "asking"
      ? "asking-for-money (investor or customer)"
      : "offering-money (supplier)";

  const reason = activeCampaignName
    ? `No template captured yet for ${activeCampaignName}. Draft a first pass below, or capture from a real send thread (Outreach-Writing-Rules-TF.md Rule 5).`
    : `No ${sideLabel} template captured yet.`;

  return (
    <div className="template-body">
      <div className="tb-from">
        <b>Archetype</b> {sideLabel}
      </div>
      <div
        style={{
          marginBottom: 12,
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px dashed var(--border)",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        {reason}
      </div>
      <Part
        label="1. Credibility paragraph"
        body={null}
        kind="prose"
        sectionKind="credibility_paragraph"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="2. Company paragraph"
        body={null}
        kind="prose"
        sectionKind="company_paragraph"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="3. Per-investor synthesis"
        body={null}
        kind="synthesis"
        sectionKind="intelligent_synthesis_template"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
      <Part
        label="4. Call to action"
        body={null}
        kind="cta"
        sectionKind="cta"
        campaignId={activeCampaignId}
        hasAnthropicKey={hasAnthropicKey}
        side={side}
      />
    </div>
  );
}

/** Footer strip with Tone / Length / Variables / rules-passed + Edit (V2). */
function TemplateFoot({
  template,
  side,
  activeCampaignId,
}: {
  template: CampaignTemplate | null;
  side: "asking" | "offering";
  activeCampaignId: string | null;
}) {
  const tone =
    side === "asking" ? "confident, hedged" : "directive buyer";

  const wordCount = template
    ? countWordsAcross(
        template.credibility_paragraph_full ??
          template.credibility_paragraph_short,
        template.company_paragraph,
        template.intelligent_synthesis_template,
      )
    : null;

  const placeholderCount = template
    ? countPlaceholders(template.intelligent_synthesis_template)
    : null;

  return (
    <div className="template-foot">
      <b>Tone</b>: {tone}
      {wordCount !== null ? (
        <>
          {" "}&middot; <b>Length</b> {wordCount} words
        </>
      ) : null}
      {placeholderCount !== null ? (
        <>
          {" "}&middot; <b>Variables</b> {placeholderCount} (resolved from
          partner modal)
        </>
      ) : null}
      <span style={{ flex: 1 }} />
      {/* Preview with real investor data — fetches the most recent
          campaign_partner and renders the full composed draft inline.
          Only shown when a campaign is active (activeCampaignId present). */}
      {activeCampaignId ? (
        <TemplatePreviewModal
          campaignId={activeCampaignId}
          side={side}
        />
      ) : null}
      {/* Duplicate button — creates a copy of the current template for
          variant testing (A/B subject lines, paragraph tweaks). */}
      {activeCampaignId && template ? (
        <DuplicateTemplateButton campaignId={activeCampaignId} />
      ) : null}
      {/* Editing happens inline via the "Redraft with Opus →" button on
          each section header (see AiSectionDrafter). The foot used to
          carry a disabled "Edit" stub — removed 2026-04-23 to stop the
          duplicate-affordance confusion. */}
      <span
        style={{
          fontSize: 11,
          color: "var(--text-faint)",
          fontStyle: "italic",
        }}
      >
        Edit any paragraph via <b>Edit ✎</b> or draft with AI via <b>Draft
        with Opus →</b> on each section header.
      </span>
    </div>
  );
}

/** Human-readable CTA copy for the foot meta. */
function ctaCopyFor(
  variant: "20min_call" | "presentation_first" | null,
): { body: string | null; meta: string } {
  if (variant === "presentation_first") {
    return {
      body: "I would be happy to send the investor presentation or arrange a call with the team.",
      meta: "Variant: presentation_first",
    };
  }
  if (variant === "20min_call") {
    return {
      body: "Would you have 20 minutes for a brief call? I am available early next week.",
      meta: "Variant: 20min_call",
    };
  }
  return { body: null, meta: "Variant: (not set on this template)" };
}

/** Count words across up to 3 body sections. Null-safe. */
function countWordsAcross(...blocks: Array<string | null | undefined>): number {
  let total = 0;
  for (const b of blocks) {
    if (!b) continue;
    total += b.trim().split(/\s+/).filter(Boolean).length;
  }
  return total;
}

/** Count {{PLACEHOLDER}} tokens in the synthesis template (0 if null). */
function countPlaceholders(tpl: string | null | undefined): number {
  if (!tpl) return 0;
  const matches = tpl.match(/\{\{[A-Z_]+\}\}/g);
  return matches ? matches.length : 0;
}
