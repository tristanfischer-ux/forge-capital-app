import type { ReactNode } from "react";
import { getSidebarDrafts, getPipelineHealth, getTrackerHealth } from "@/lib/queries/sidebar";
import type { CampaignSummary } from "@/lib/queries/campaigns";

/**
 * Right-rail sidebar — §1b of the V4 cutover. Stacks four side-cards
 * per Phase2-Mockup-V4.html lines 2178–2270:
 *
 *   1. Drafts ready for review   — real +2 Drafted campaign_partners rows
 *                                   rendered against the campaign template
 *   2. Pipeline health           — live counts from campaign_partners
 *   3. This week's rhythm        — V4-faithful hard-coded placeholder.
 *                                   Real orchestration events land in
 *                                   Phase 7+.
 *   4. Tracker health            — the StatusSummary data as a vertical
 *                                   list (V4 card style) rather than
 *                                   the horizontal chip strip.
 *
 * The sidebar is 340px wide (matches V4 `.side`) and stacks under the
 * main content below the `xl` breakpoint (~1180px, matching V4's
 * `@media (max-width: 1180px) { .side { display: none; } }` — we keep
 * it stacked rather than hidden so the data remains reachable).
 *
 * Async server component: fetches all four card data sets in parallel.
 */
export async function Sidebar({
  campaign,
}: {
  campaign: CampaignSummary;
}) {
  const [drafts, health, trackerHealth] = await Promise.all([
    getSidebarDrafts(campaign.id, 3),
    getPipelineHealth(campaign.id, campaign.name, campaign.created_at),
    getTrackerHealth(campaign.id),
  ]);

  return (
    <aside
      className="w-full shrink-0 space-y-4 xl:w-[340px] xl:pl-0"
      aria-label="Campaign health rail"
    >
      <SideCardDrafts drafts={drafts} />
      <SideCardPipelineHealth health={health} />
      <SideCardRhythm />
      <SideCardTrackerHealth trackerHealth={trackerHealth} />
    </aside>
  );
}

/* ------------------------------------------------------------------
   SideCard — shared chrome for the four cards.
   Maps to V4 `.side-card` (lines 273–277): white surface, border,
   radius 12, padding 18/20, standard shadow, 16px bottom gap.
   ------------------------------------------------------------------ */

function SideCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-border bg-surface px-5 py-[18px] shadow-[var(--shadow)]">
      <h3 className="text-[13px] font-semibold tracking-tight text-text">{title}</h3>
      {subtitle ? (
        <div className="mt-0.5 mb-3.5 text-[11px] text-text-dim">{subtitle}</div>
      ) : (
        <div className="mb-3.5" />
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------
   Card 1 — Drafts ready for review
   V4 lines 2180–2224. Gmail-authoritative framing + up to 3 draft
   previews + an accent note at the foot. When no +2 Drafted rows
   exist (V1 default), show an honest empty state.
   ------------------------------------------------------------------ */

import type { SidebarDraftRow } from "@/lib/queries/sidebar";

function SideCardDrafts({ drafts }: { drafts: SidebarDraftRow[] }) {
  return (
    <SideCard
      title="Drafts ready for review"
      subtitle={
        <>Gmail is the source of truth. We never send &mdash; you review and send from Gmail.</>
      }
    >
      {drafts.length === 0 ? (
        <DraftsEmpty />
      ) : (
        <>
          {drafts.map((d, i) => (
            <DraftPreview key={d.campaign_partner_id} draft={d} first={i === 0} />
          ))}
          <div className="mt-2.5 rounded-[6px] border border-dashed border-[#c7d2fe] bg-accent-softer px-2.5 py-2 text-[11px] leading-snug text-accent-dark">
            Gmail is authoritative. Drafts sync back every 60s &mdash; reply/edit/send
            there.
          </div>
        </>
      )}
    </SideCard>
  );
}

function DraftsEmpty() {
  return (
    <div className="rounded-[6px] border border-dashed border-border bg-surface-alt px-3 py-4 text-[11px] leading-snug text-text-dim">
      No drafts ready. Drafts land here when partners move to{" "}
      <span className="font-mono text-[10px] text-text">+2 Drafted</span>.
    </div>
  );
}

function DraftPreview({ draft, first }: { draft: SidebarDraftRow; first: boolean }) {
  // Mirror V4 `.draft` + `.draft-to` / `.draft-subj` / `.draft-preview` /
  // `.draft-row`. First child has no top border (V4 line 283).
  const topBorder = first
    ? "border-t-0 pt-1"
    : "border-t border-border-soft pt-3";

  const firmSegment = draft.firm_name ?? "—";
  const partnerSegment = draft.partner_name ?? "—";

  const savedCopy = draft.saved_minutes_ago === null
    ? "Saved just now"
    : formatSavedMinutesAgo(draft.saved_minutes_ago);

  return (
    <article className={`pb-3 ${topBorder}`}>
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-text-dim">
        <span>To</span>
        <span className="font-semibold text-text">
          {partnerSegment} &middot; {firmSegment}
        </span>
      </div>
      <div className="mb-1 text-[13px] font-medium leading-snug text-text">
        {draft.subject ?? <span className="italic text-text-faint">— subject pending template wiring —</span>}
      </div>
      <div className="mb-2 line-clamp-2 overflow-hidden text-[12px] leading-normal text-text-dim">
        {draft.preview || (
          <span className="italic text-text-faint">
            Body preview appears here once the template renders.
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-text-faint">
        <span>{savedCopy}</span>
        <span className="text-text-faint">·</span>
        <span>{draft.word_count} words</span>
        <span className="flex-1" />
        <span
          className="inline-flex cursor-not-allowed items-center gap-1 rounded-[6px] border border-border bg-surface-alt px-2.5 py-1 font-medium text-text opacity-70"
          title="Gmail deep-links land in Phase 6"
        >
          Open in Gmail <span aria-hidden="true">↗</span>
        </span>
      </div>
    </article>
  );
}

function formatSavedMinutesAgo(minutes: number): string {
  if (minutes < 1) return "Saved just now";
  if (minutes < 60) return `Saved ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Saved ${days}d ago`;
}

/* ------------------------------------------------------------------
   Card 2 — Pipeline health at a glance
   V4 lines 2226–2238. Five labelled KV rows + a "Next auto-batch run"
   footer. Week-of-16 resolves from campaign.created_at; if unavailable
   we say "· active" rather than fake a week number.
   ------------------------------------------------------------------ */

import type { PipelineHealth } from "@/lib/queries/sidebar";

function SideCardPipelineHealth({ health }: { health: PipelineHealth }) {
  const weekSubcopy = health.week_of_sixteen
    ? `week ${health.week_of_sixteen} of 16`
    : "active";

  return (
    <SideCard
      title="Pipeline health at a glance"
      subtitle={
        <>
          {health.campaign_name} &middot; {weekSubcopy}
        </>
      }
    >
      <KVRow k="In approval queue" v={health.in_approval_queue} tone="accent" />
      <KVRow k="In Gmail drafts" v={health.in_gmail_drafts} />
      <KVRow k="Sent, awaiting" v={health.sent_awaiting} />
      <KVRow
        k="Replies pending log"
        v={health.replies_pending_log}
        tone={health.replies_pending_log > 0 ? "green" : undefined}
      />
      <KVRow
        k="Gate-blocked"
        v={health.gate_blocked}
        tone={health.gate_blocked > 0 ? "amber" : undefined}
      />
      <div className="mt-1.5 border-t border-border-soft pt-2">
        <KVRow
          k="Next auto-batch run"
          v={
            <span title="Hard-coded in V1 — wires to cron scheduler in Phase 8">
              Tue 09:00
            </span>
          }
          tone="accent"
        />
      </div>
    </SideCard>
  );
}

/**
 * Two-column key/value row that matches V4 `.ms-kv`. The value side is
 * right-aligned, bold, with optional tone colouring.
 */
function KVRow({
  k,
  v,
  tone,
}: {
  k: string;
  v: number | ReactNode;
  tone?: "accent" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "green"
        ? "text-green"
        : tone === "amber"
          ? "text-amber"
          : tone === "red"
            ? "text-red"
            : "text-text";

  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[12px]">
      <span className="shrink-0 text-text-dim">{k}</span>
      <span className={`text-right font-medium ${toneClass}`}>{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------
   Card 3 — This week's rhythm
   V4 lines 2240–2250. Five status-dot rows: done / active / pending.
   V1 note: these are V4-faithful hard-coded placeholder copy. Real
   orchestration events (pool re-scored, batch approval sent, etc.)
   land with the runner in Phase 7+. Flagged in the comment so future
   sessions don't mistake these for live data.
   ------------------------------------------------------------------ */

type RhythmState = "done" | "active" | "pending";

interface RhythmItem {
  state: RhythmState;
  label: string;
  meta: string;
}

/**
 * Hard-coded for V1 — copy lifted verbatim from V4 mockup lines 2244–2248
 * so the sidecard reads like the target screenshot. Becomes a real
 * query once the orchestration runner lands; until then honesty is
 * preserved via the hover title on the status dots.
 */
const RHYTHM_ITEMS_V4: RhythmItem[] = [
  { state: "done", label: "Pool re-scored · 1,524", meta: "Mon 21 Apr 08:00" },
  { state: "done", label: "Batch 2 approval sent", meta: "Mon 09:12 · 34 rows" },
  { state: "active", label: "Awaiting Stephan reply", meta: "avg reply time 2d 4h" },
  { state: "pending", label: "Drafts auto-generated", meta: "on ingest" },
  { state: "pending", label: "Friday weekly update", meta: "Fri 25 Apr 17:00 BST" },
];

function SideCardRhythm() {
  return (
    <SideCard
      title="This week's rhythm"
      subtitle="Autonomous runs happen; flags come to you"
    >
      <ul className="mt-1 list-none space-y-0 p-0">
        {RHYTHM_ITEMS_V4.map((item) => (
          <RhythmRow key={item.label} item={item} />
        ))}
      </ul>
      <div className="mt-2.5 text-[10px] italic text-text-faint">
        Placeholder events &mdash; wire to orchestration runner in Phase 7+.
      </div>
    </SideCard>
  );
}

function RhythmRow({ item }: { item: RhythmItem }) {
  // V4 `.ms-step .bullet` — 14×14 circle with ✓ (done), ● (active), ○ (pending).
  const labelClass =
    item.state === "done"
      ? "text-text-dim line-through decoration-text-faint"
      : "text-text font-medium";

  const bullet =
    item.state === "done" ? (
      <span
        className="mt-0.5 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-green text-[9px] text-white"
        aria-label="Complete"
      >
        ✓
      </span>
    ) : item.state === "active" ? (
      <span
        className="mt-0.5 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-accent text-[9px] text-white shadow-[0_0_0_3px_var(--accent-light)]"
        aria-label="In progress"
      >
        ●
      </span>
    ) : (
      <span
        className="mt-0.5 inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-border text-[9px] text-white"
        aria-label="Not yet"
      >
        ○
      </span>
    );

  return (
    <li className="flex items-start gap-2.5 py-[5px] text-[11px]">
      {bullet}
      <div className="min-w-0">
        <div className={labelClass}>{item.label}</div>
        <div className="mt-0.5 text-[10px] text-text-faint">{item.meta}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------
   Card 4 — Tracker health
   V4 lines 2252–2268. Vertical KV list of every populated status code.
   "+6 / +8 / +10" get the green tone; "-2 Bounced" gets red. Footer
   shows "Total touched · X / Y" where Y is total rows.
   ------------------------------------------------------------------ */

import type { TrackerHealth } from "@/lib/queries/sidebar";

function SideCardTrackerHealth({ trackerHealth }: { trackerHealth: TrackerHealth }) {
  const { rows, total, touched } = trackerHealth;

  if (rows.length === 0) {
    return (
      <SideCard
        title="Tracker health"
        subtitle="Live vocabulary from the master sheet"
      >
        <div className="rounded-[6px] border border-dashed border-border bg-surface-alt px-3 py-4 text-[11px] leading-snug text-text-dim">
          No partner rows yet. Counts populate per status as the nightly sync
          lands rows on the tracker.
        </div>
      </SideCard>
    );
  }

  return (
    <SideCard
      title="Tracker health"
      subtitle="Live vocabulary from the master sheet"
    >
      {rows.map((row) => {
        // Colour tone follows the family (positive codes green, dead red).
        let tone: "green" | "red" | "amber" | undefined;
        if (row.family === "committed") tone = "green";
        else if (row.family === "progressing" && (row.code === "+6" || row.code === "+7")) tone = "green";
        else if (row.code === "-2") tone = "red";

        return (
          <KVRow
            key={row.code}
            k={`${row.code} ${row.label}`}
            v={row.count}
            tone={tone}
          />
        );
      })}
      <div className="mt-1.5 border-t border-border-soft pt-2">
        <KVRow k="Total touched" v={`${touched} / ${total}`} tone="accent" />
      </div>
    </SideCard>
  );
}
