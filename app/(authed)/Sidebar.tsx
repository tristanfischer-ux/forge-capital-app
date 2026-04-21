import type { ReactNode } from "react";
import {
  getSidebarDrafts,
  getPipelineHealth,
  getTrackerHealth,
} from "@/lib/queries/sidebar";
import type { CampaignSummary } from "@/lib/queries/campaigns";
import type {
  SidebarDraftRow,
  PipelineHealth,
  TrackerHealth,
} from "@/lib/queries/sidebar";

/**
 * Right-rail sidebar — 1:1 port of V4 `<aside class="side">` stack
 * (Phase2-Mockup-V4.html lines 2178-2270).
 *
 * V4 class vocabulary (v4-mockup.css lines 225-245):
 *   Outer:  `.side` (wrapper, 340px, applied to <aside>)
 *   Each card:
 *     - `.side-card`        — white surface, 12px radius, shadow, 16px
 *                             bottom gap
 *     - `.side-card h3`     — card title (auto-styled)
 *     - `.side-sub`         — muted caption under the title
 *   Drafts card:
 *     - `.draft` / `.draft-to` / `.draft-subj` / `.draft-preview`
 *     - `.draft-row`        — bottom row of meta + Gmail button
 *     - `.btn-gmail`        — "Open in Gmail ↗"
 *     - `.side-note`        — dashed indigo callout at the foot
 *   Pipeline / Tracker cards:
 *     - `.ms-kv` / `.k` / `.v` — two-column key/value rows
 *   Rhythm card:
 *     - `.ms-stepper` / `.ms-step` / `.ms-step.done` / `.ms-step.active`
 *     - `.bullet` / `.label` / `.meta`
 *
 * Cards (top to bottom, per V4):
 *   1. Drafts ready for review   — live +2 Drafted campaign_partners
 *   2. Pipeline health at a glance — live counts
 *   3. This week's rhythm        — V4-faithful placeholder until the
 *                                   orchestration runner lands
 *   4. Tracker health            — vertical KV of every populated
 *                                   status code
 *
 * Responsiveness: V4 hides `.side` below 1180px via
 * `@media (max-width: 1180px) { .side { display: none; } }` (CSS line
 * 664). We keep that behaviour — the sidebar data remains reachable
 * via direct navigation on small screens.
 */
export async function Sidebar({ campaign }: { campaign: CampaignSummary }) {
  const [drafts, health, trackerHealth] = await Promise.all([
    getSidebarDrafts(campaign.id, 3),
    getPipelineHealth(campaign.id, campaign.name, campaign.created_at),
    getTrackerHealth(campaign.id),
  ]);

  return (
    <aside className="side" aria-label="Campaign health rail">
      <SideCardDrafts drafts={drafts} />
      <SideCardPipelineHealth health={health} />
      <SideCardRhythm />
      <SideCardTrackerHealth trackerHealth={trackerHealth} />
    </aside>
  );
}

/* ------------------------------------------------------------------
   Shared SideCard chrome — emits V4's `.side-card` markup. Title
   renders as plain `<h3>` (V4 styles `.side-card h3` automatically);
   subtitle renders as `.side-sub`.
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
    <div className="side-card">
      <h3>{title}</h3>
      {subtitle ? <div className="side-sub">{subtitle}</div> : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------
   Card 1 — Drafts ready for review (V4 lines 2180-2224)
   ------------------------------------------------------------------ */

function SideCardDrafts({ drafts }: { drafts: SidebarDraftRow[] }) {
  return (
    <SideCard
      title="Drafts ready for review"
      subtitle={
        <>
          Gmail is the source of truth. We never send &mdash; you review and
          send from Gmail.
        </>
      }
    >
      {drafts.length === 0 ? (
        <DraftsEmpty />
      ) : (
        <>
          {drafts.map((d) => (
            <DraftItem key={d.campaign_partner_id} draft={d} />
          ))}
          <div className="side-note">
            Gmail is authoritative. Drafts sync back every 60s &mdash;
            reply/edit/send there.
          </div>
        </>
      )}
    </SideCard>
  );
}

function DraftsEmpty() {
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px dashed var(--border)",
        background: "var(--surface-alt)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--text-dim)",
        lineHeight: 1.5,
      }}
    >
      No drafts ready. Drafts land here when partners move to{" "}
      <span
        style={{
          fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
          fontSize: 10,
          color: "var(--text)",
        }}
      >
        +2 Drafted
      </span>
      .
    </div>
  );
}

function DraftItem({ draft }: { draft: SidebarDraftRow }) {
  const firmSegment = draft.firm_name ?? "—";
  const partnerSegment = draft.partner_name ?? "—";
  const savedCopy =
    draft.saved_minutes_ago === null
      ? "Saved just now"
      : formatSavedMinutesAgo(draft.saved_minutes_ago);

  return (
    <div className="draft">
      <div className="draft-to">
        <span>To</span>{" "}
        <span className="firm">
          {partnerSegment} &middot; {firmSegment}
        </span>
      </div>
      <div className="draft-subj">
        {draft.subject ?? (
          <span style={{ fontStyle: "italic", color: "var(--text-faint)" }}>
            &mdash; subject pending template wiring &mdash;
          </span>
        )}
      </div>
      <div className="draft-preview">
        {draft.preview || (
          <span style={{ fontStyle: "italic", color: "var(--text-faint)" }}>
            Body preview appears here once the template renders.
          </span>
        )}
      </div>
      <div className="draft-row">
        <span>{savedCopy}</span>
        <span style={{ color: "var(--text-faint)" }}>&middot;</span>
        <span>{draft.word_count} words</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn-gmail"
          disabled
          title="Gmail deep-links land in Phase 6"
          style={{ opacity: 0.7, cursor: "not-allowed" }}
        >
          Open in Gmail &#8599;
        </button>
      </div>
    </div>
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
   Card 2 — Pipeline health at a glance (V4 lines 2226-2238)
   ------------------------------------------------------------------ */

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
      <MsKv k="In approval queue" v={health.in_approval_queue} tone="accent" />
      <MsKv k="In Gmail drafts" v={health.in_gmail_drafts} />
      <MsKv k="Sent, awaiting" v={health.sent_awaiting} />
      <MsKv
        k="Replies pending log"
        v={health.replies_pending_log}
        tone={health.replies_pending_log > 0 ? "green" : undefined}
      />
      <MsKv
        k="Gate-blocked"
        v={health.gate_blocked}
        tone={health.gate_blocked > 0 ? "amber" : undefined}
      />
      {/* V4 line 2235: inline-style border-top + tight padding for the
          footer row. */}
      <div
        className="ms-kv"
        style={{
          borderTop: "1px solid var(--border-soft)",
          marginTop: 6,
          paddingTop: 8,
        }}
      >
        <span className="k">Next auto-batch run</span>
        <span
          className="v"
          style={{ color: "var(--accent)" }}
          title="Hard-coded in V1 — wires to cron scheduler in Phase 8"
        >
          Tue 09:00
        </span>
      </div>
    </SideCard>
  );
}

/**
 * Two-column key/value row — V4 `.ms-kv` (v4-mockup.css line 552).
 * The value side carries the tone class via an inline CSS var colour
 * because V4's `.ms-kv .v` has no tone modifiers; V4 itself applies
 * colour via inline style on the value span. We do the same.
 */
function MsKv({
  k,
  v,
  tone,
}: {
  k: string;
  v: number | ReactNode;
  tone?: "accent" | "green" | "amber" | "red";
}) {
  const colour =
    tone === "accent"
      ? "var(--accent)"
      : tone === "green"
        ? "var(--green)"
        : tone === "amber"
          ? "var(--amber)"
          : tone === "red"
            ? "var(--red)"
            : undefined;

  return (
    <div className="ms-kv">
      <span className="k">{k}</span>
      <span className="v" style={colour ? { color: colour } : undefined}>
        {v}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------
   Card 3 — This week's rhythm (V4 lines 2240-2250)
   V4 ships these as hard-coded copy. V1 keeps them that way until
   the orchestration runner lands (Phase 7+) — flagged in-code so
   future sessions don't mistake placeholder copy for live data.
   ------------------------------------------------------------------ */

type RhythmState = "done" | "active" | "pending";

interface RhythmItem {
  state: RhythmState;
  label: string;
  meta: string;
}

/** Copy lifted verbatim from V4 lines 2244-2248. */
const RHYTHM_ITEMS_V4: RhythmItem[] = [
  { state: "done", label: "Pool re-scored · 1,524", meta: "Mon 21 Apr 08:00" },
  { state: "done", label: "Batch 2 approval sent", meta: "Mon 09:12 · 34 rows" },
  {
    state: "active",
    label: "Awaiting Stephan reply",
    meta: "avg reply time 2d 4h",
  },
  { state: "pending", label: "Drafts auto-generated", meta: "on ingest" },
  {
    state: "pending",
    label: "Friday weekly update",
    meta: "Fri 25 Apr 17:00 BST",
  },
];

function SideCardRhythm() {
  return (
    <SideCard
      title="This week's rhythm"
      subtitle="Autonomous runs happen; flags come to you"
    >
      <ul className="ms-stepper">
        {RHYTHM_ITEMS_V4.map((item) => (
          <RhythmRow key={item.label} item={item} />
        ))}
      </ul>
    </SideCard>
  );
}

function RhythmRow({ item }: { item: RhythmItem }) {
  const stateClass =
    item.state === "done"
      ? "ms-step done"
      : item.state === "active"
        ? "ms-step active"
        : "ms-step";
  const bullet =
    item.state === "done" ? "✓" : item.state === "active" ? "●" : "○";

  return (
    <li className={stateClass}>
      <span className="bullet" aria-hidden="true">
        {bullet}
      </span>
      <div>
        <div className="label">{item.label}</div>
        <div className="meta">{item.meta}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------
   Card 4 — Tracker health (V4 lines 2252-2268)
   Vertical KV of every populated status code. +6/+8/+10 get green;
   -2 gets red. Footer shows total touched / total rows.
   ------------------------------------------------------------------ */

function SideCardTrackerHealth({
  trackerHealth,
}: {
  trackerHealth: TrackerHealth;
}) {
  const { rows, total, touched } = trackerHealth;

  if (rows.length === 0) {
    return (
      <SideCard
        title="Tracker health"
        subtitle="Live vocabulary from the master sheet"
      >
        <div
          style={{
            padding: "12px 14px",
            border: "1px dashed var(--border)",
            background: "var(--surface-alt)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
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
        let tone: "green" | "red" | "amber" | undefined;
        if (row.family === "committed") tone = "green";
        else if (
          row.family === "progressing" &&
          (row.code === "+6" || row.code === "+7")
        )
          tone = "green";
        else if (row.code === "-2") tone = "red";

        return (
          <MsKv
            key={row.code}
            k={`${row.code} ${row.label}`}
            v={row.count}
            tone={tone}
          />
        );
      })}
      <div
        className="ms-kv"
        style={{
          borderTop: "1px solid var(--border-soft)",
          marginTop: 6,
          paddingTop: 8,
        }}
      >
        <span className="k">Total touched</span>
        <span className="v" style={{ color: "var(--accent)" }}>
          {touched} / {total}
        </span>
      </div>
    </SideCard>
  );
}
