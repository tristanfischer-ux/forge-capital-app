import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvestorModalData } from "@/lib/queries/investorModal";
import type { EmailTier } from "@/lib/queries/tracker";
import { TierBadge } from "../../TierBadge";
import { StatusBadge } from "../../StatusBadge";
import { composeDraft, isTierBlocked } from "./compose";
import { CopyToClipboardButton } from "./CopyToClipboardButton";
import { CreateGmailDraftButton } from "./CreateGmailDraftButton";
import { SendGmailMessageButton } from "./SendGmailMessageButton";
import { RefineSynthesisButton } from "./RefineSynthesisButton";

/**
 * Full-page preview of the draft email that WOULD be sent to this partner.
 *
 * Phase 3 is clipboard-only — no Gmail API wire-up (Phase 4). The page
 * composes the 4-part template per REAL-TEMPLATES-FROM-GMAIL.md, renders
 * it in a read-only preview, and offers a single primary action:
 * "Copy to Gmail-ready text".
 *
 * Blocked tiers (generic_blocked / bounced / unverified) show a red banner
 * explaining why, WITHOUT a copy button. V4-FEEDBACK-ROUND-2.md was explicit
 * that the three blocked tiers surface with a "Hunt for a real contact" or
 * "Run Hunter verifier" CTA — we show both as stubs (no handler) per the
 * Phase 3 brief ("both stubbed; no code needed behind them — just the banner
 * copy").
 */

export default async function DraftPage({
  params,
}: {
  // Next.js 16 App Router: params is a Promise in RSCs.
  params: Promise<{ campaignPartnerId: string }>;
}) {
  const { campaignPartnerId } = await params;
  if (!campaignPartnerId) notFound();

  const data = await getInvestorModalData(campaignPartnerId);
  if (!data) {
    return <DraftNotFound />;
  }

  const draft = composeDraft(data);
  const tier = data.primary_partner?.email_tier ?? null;
  const blocked = isTierBlocked(tier);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      {/* Breadcrumb back to tracker */}
      <div className="mb-4 text-[12px] text-text-dim">
        <Link
          href="/tracker"
          className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
        >
          ← Back to tracker
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">
          Draft email preview
        </h1>
        <p className="mt-1 text-[13px] text-text-dim">
          Review the rendered draft below. Gmail remains the authoritative
          send — copy the text, paste into a new compose, review once more,
          then send.
        </p>
      </header>

      {/* Header card: campaign + status */}
      <section className="mb-4 rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <span className="font-semibold text-text">
            {data.campaign?.name ?? "Unnamed campaign"}
          </span>
          {data.campaign?.raise_size ? (
            <span className="text-text-dim">· {data.campaign.raise_size}</span>
          ) : null}
          {data.primary_partner?.status_code ? (
            <StatusBadge
              statusCode={data.primary_partner.status_code}
              statusLabel={data.primary_partner.status_label}
            />
          ) : null}
        </div>
      </section>

      {/* Blocked banner */}
      {blocked ? (
        <BlockedBanner tier={tier} partnerEmail={data.primary_partner?.email ?? null} />
      ) : null}

      {/* Subject / to card */}
      <section className="mb-4 rounded-[10px] border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <div className="space-y-3 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <span className="min-w-[70px] text-[11px] font-semibold uppercase tracking-wide text-text-dim">
              Subject
            </span>
            <span className="font-medium text-text">{draft.subject}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[70px] text-[11px] font-semibold uppercase tracking-wide text-text-dim">
              To
            </span>
            <span className="text-text">
              {data.primary_partner?.id != null ? (
                <Link
                  href={`/partner/${data.primary_partner.id}`}
                  className="partner-link"
                  aria-label={`Open partner profile for ${draft.toDisplay}`}
                >
                  {draft.toDisplay}
                </Link>
              ) : (
                draft.toDisplay
              )}
              {draft.toEmail ? (
                <span className="ml-1 text-text-dim">
                  &lt;{draft.toEmail}&gt;
                </span>
              ) : (
                <span className="ml-1 italic text-text-faint">
                  (no email on file)
                </span>
              )}
            </span>
            <TierBadge tier={tier} />
          </div>
          {data.investor.firm_name ? (
            <div className="flex flex-wrap gap-2">
              <span className="min-w-[70px] text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                Firm
              </span>
              <span className="text-text">{data.investor.firm_name}</span>
            </div>
          ) : null}
        </div>
      </section>

      {/* Draft body */}
      <section className="mb-4 rounded-[10px] border border-border bg-surface p-6 shadow-[var(--shadow)]">
        <DraftBody draft={draft} />
      </section>

      {/* Opus refine — regenerate the synthesis paragraph per-investor
          to fix grammar stumbles from token substitution. */}
      {!blocked && data.primary_partner ? (
        <section className="mb-4 rounded-[10px] border border-dashed border-border bg-surface-alt p-4">
          <RefineSynthesisButton
            campaignPartnerId={campaignPartnerId}
            hasRendered={Boolean(data.rendered_synthesis)}
            renderedAt={data.rendered_synthesis_at}
          />
        </section>
      ) : null}

      {/* Draft-level warnings */}
      {draft.thesisTooLongToHedge ? (
        <ReviewWarning>
          <strong>Thesis too long to auto-hedge — review manually.</strong>{" "}
          The firm&apos;s thesis summary did not compress cleanly into a
          Rule-1 hedged clause, so the <code>{"{{FIRM_THESIS}}"}</code>{" "}
          placeholder is still visible above. Edit the synthesis paragraph in
          Gmail before sending.
        </ReviewWarning>
      ) : null}
      {draft.unresolvedPlaceholders.length > 0 ? (
        <ReviewWarning>
          <strong>Unresolved template placeholders:</strong>{" "}
          {draft.unresolvedPlaceholders.join(", ")} — fill these in before
          sending.
        </ReviewWarning>
      ) : null}

      {/* Primary action — only when not blocked */}
      {!blocked ? (
        <section className="rounded-[10px] border border-border bg-surface-alt p-5">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SendGmailMessageButton
              to={data.primary_partner?.email ?? ""}
              subject={draft.subject}
              body={draft.fullBody}
            />
            <CreateGmailDraftButton
              to={data.primary_partner?.email ?? ""}
              subject={draft.subject}
              body={draft.fullBody}
            />
            <CopyToClipboardButton fullText={draft.fullClipboardText} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
            <strong>Send via Gmail</strong> dispatches immediately (after a
            confirm step). <strong>Create Gmail draft</strong> parks it in
            your Drafts folder for one more review. <strong>Copy to
            clipboard</strong> is the fallback. All three use your
            connected Gmail account.
          </p>
        </section>
      ) : null}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DraftNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
      <h1 className="text-xl font-semibold text-text">No partner found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-dim">
        This tracker row does not exist, or the Forge Capital sync has not
        populated it yet.
      </p>
      <Link
        href="/tracker"
        className="mt-6 inline-flex rounded-lg border border-accent bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-dark"
      >
        Back to tracker
      </Link>
    </main>
  );
}

function DraftBody({ draft }: { draft: ReturnType<typeof composeDraft> }) {
  const salutationLine = draft.firstName
    ? `Dear ${draft.firstName},`
    : "Dear [first name],";

  return (
    <article className="space-y-5 text-[13px] leading-relaxed text-text">
      <p className="font-medium">{salutationLine}</p>
      {draft.bodyParagraphs.map((para, idx) => (
        <p key={idx} className="whitespace-pre-wrap">
          {para}
        </p>
      ))}
      <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-text">
        {draft.signOff}
      </pre>
    </article>
  );
}

function ReviewWarning({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-[10px] border border-amber bg-amber-light px-4 py-3 text-[12px] text-amber">
      {children}
    </section>
  );
}

function BlockedBanner({
  tier,
  partnerEmail,
}: {
  tier: EmailTier;
  partnerEmail: string | null;
}) {
  // Tier-specific copy. Sendable tiers never reach this banner — the
  // page-level `isTierBlocked` short-circuits before render. Updated
  // 2026-04-23 to cover the NeverBounce variants.
  const copy =
    tier === "generic_blocked"
      ? {
          headline: "This is a generic address — do not send.",
          detail:
            partnerEmail
              ? `${partnerEmail} matches a generic pattern (info@ / contact@ / team@). Partner emails routing to generics are a red flag, not a yellow one — hunt for the named-partner address before drafting.`
              : "No email on file, and the last known pattern was generic (info@ / contact@ / team@). Hunt for a named-partner address before drafting.",
        }
      : tier === "bounced"
        ? {
            headline: "This address has bounced — do not send.",
            detail: partnerEmail
              ? `${partnerEmail} hard-bounced on a previous send. The address is blocked; resolve a replacement before drafting.`
              : "The partner's email hard-bounced on a previous send. Hunt for a replacement before drafting.",
          }
        : tier === "neverbounce_invalid"
          ? {
              headline:
                "NeverBounce confirmed undeliverable — do not send.",
              detail: partnerEmail
                ? `${partnerEmail} returned an invalid verdict from NeverBounce. Sending would near-guarantee a bounce; hunt for a current address before drafting.`
                : "NeverBounce flagged the last address on file as invalid. Hunt for a current address before drafting.",
            }
          : tier === "neverbounce_disposable"
            ? {
                headline:
                  "Disposable mailbox — do not send.",
                detail: partnerEmail
                  ? `${partnerEmail} is a disposable / throwaway address. It won't reach anyone real; hunt for the partner's actual work address before drafting.`
                  : "The address on file is a disposable / throwaway mailbox. Hunt for the partner's real work address before drafting.",
              }
            : tier === "neverbounce_unknown"
              ? {
                  headline:
                    "NeverBounce returned no verdict — cannot advance to +2 Drafted.",
                  detail:
                    "The receiving server timed out or refused NeverBounce's probe. Run the Hunter verifier or confirm prior correspondence in Gmail before drafting.",
                }
              : {
                  headline:
                    "Email not verified — cannot advance to +2 Drafted.",
                  detail:
                    "This partner has no deliverability tier on file. Run the Hunter verifier or confirm prior correspondence in Gmail before drafting.",
                };

  return (
    <section className="mb-4 rounded-[10px] border border-red bg-red-light px-5 py-4">
      <h3 className="text-[13px] font-semibold text-red">{copy.headline}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-red">{copy.detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-[#fecaca] bg-white px-3 py-1.5 text-[12px] font-medium text-red opacity-80"
          title="Phase 5 will wire this to the replacement-hunt workflow."
        >
          Hunt for a real contact
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-[#fecaca] bg-white px-3 py-1.5 text-[12px] font-medium text-red opacity-80"
          title="Phase 5 will wire this to the Hunter verifier."
        >
          Run Hunter verifier
        </button>
      </div>
    </section>
  );
}
