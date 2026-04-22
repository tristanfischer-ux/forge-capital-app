"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Archetype,
  GetMatchScoreResult,
  MatchResultRow,
  ScoreDims,
} from "@/lib/queries/match-score-types";
import { detectArchetypeSignals } from "@/lib/queries/match-score-types";
import { findMatches, findLookalikes, shortlistSelected } from "./match-v4-actions";
import { DEFAULT_HERO_TEXT } from "./match-constants";
import {
  MIN_LOOKALIKE_ANCHORS,
  type LookalikeAnchor,
  type LookalikeResult,
  type LookalikeRow,
} from "@/lib/queries/lookalikes-types";

/**
 * §3 Find-a-Match — V4 lines 912–1147.
 *
 * Port strategy (per `CLAUDE.md §"Use V4's CSS directly — it's already
 * imported"`): the DOM structure and class names are lifted from V4
 * verbatim. V4's CSS (imported via `app/v4-mockup.css`) provides every
 * class used below — `.hero`, `.hero-title`, `.hero-sub`, `.hero-input-wrap`,
 * `.hero-input`, `.hero-btn`, `.kbd`, `.arch-row`, `.arch-card`,
 * `.arch-card.active`, `.arch-head`, `.arch-ico`, `.arch-title`,
 * `.arch-dir`, `.arch-desc`, `.arch-example`, `.arch-suggest`, `.as-ico`,
 * `.as-link`, `.substrate-hint`, `.conflict-banner`, `.cb-icon`,
 * `.cb-link`, `.batch-bar`, `.bb-sel`, `.bb-chk`, `.bb-label`,
 * `.bb-count`, `.bb-spacer`, `.bb-btn`, `.results-head`, `.results-title`,
 * `.count`, `.section-sub`, `.results-sort`, `.result-card`, `.rc-chk-col`,
 * `.rc-chk`, `.rc-body`, `.result-top`, `.result-headline`,
 * `.result-name`, `.firm`, `.result-meta`, `.sep`, `.result-score`,
 * `.score-pct`, `.score-label`, `.scorecard`, `.dim`, `.d-hi`, `.d-md`,
 * `.d-lo`, `.dim-lbl`, `.dim-bar`, `.dim-fill`, `.dim-val`, `.near-miss`,
 * `.result-tags`, `.tag-chip`, `.tag-approved`, `.tag-warn`,
 * `.tag-blocked`, `.tag-status`, `.dot`, `.walk-callout`, `.wc-num`.
 * **We do NOT re-derive these with Tailwind.**
 *
 * Classes V4 did NOT provide (flagged):
 *  - Toast / feedback row — V4's mockup has no shortlist-ack affordance.
 *    Rendered with inline CSS variables so it still matches the token
 *    palette. No Tailwind used.
 *  - Empty states — V4 always renders 5 cards, so there's no V4 class
 *    for "no matches" or "archetype pool not wired yet". Inline styles
 *    with CSS-variable tokens — no Tailwind.
 *  - Inline `style` attributes on the two places V4 uses them verbatim:
 *    the batch-bar separator span (V4 line 980) and the trailing
 *    "+ 5 more between 67-71%" paragraph (V4 line 1144). Preserved
 *    1:1 from V4.
 *
 * Data wiring: the initial scored top-10 comes from `getMatchScore` on
 * the server. Client interactions (edit textarea → press Find matches,
 * change archetype, change tab, tick checkboxes, shortlist) call the
 * V4 server actions. Hero text persists to localStorage per campaignId.
 *
 * Light theme only. British spelling. Fischer c-h.
 */

export interface FindAMatchProps {
  campaignId: string;
  campaignName: string;
  initialData: GetMatchScoreResult;
  initialArchetype: Archetype;
}

type Tab = "best" | "thesis" | "near_miss" | "lookalike";

interface PoolCounts {
  investor: number;
}

export function FindAMatch({
  campaignId,
  campaignName,
  initialData,
  initialArchetype,
}: FindAMatchProps) {
  const router = useRouter();

  const [heroText, setHeroText] = useState<string>(DEFAULT_HERO_TEXT);
  const [archetype, setArchetype] = useState<Archetype>(initialArchetype);
  const [data, setData] = useState<GetMatchScoreResult>(initialData);
  const [tab, setTab] = useState<Tab>("best");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isShortlisting, startShortlistTransition] = useTransition();
  // Lookalike result is held separately from the hero-text match data
  // so switching tabs back to Best/Thesis/Near-miss restores the
  // existing scored rows without re-running the (slower) hero scorer.
  const [lookalikeData, setLookalikeData] = useState<LookalikeResult | null>(null);
  const [isLookalikePending, startLookalikeTransition] = useTransition();
  const [toast, setToast] = useState<
    | { kind: "ok"; shortlisted: number; skipped: Array<{ name: string; reason: string }> }
    | { kind: "err"; message: string }
    | null
  >(null);

  // Load persisted hero text per campaign on mount.
  useEffect(() => {
    const key = `fc_hero_text_${campaignId}`;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (stored && stored.trim().length > 0) {
      setHeroText(stored);
    }
  }, [campaignId]);

  // Persist hero text (debounced at 500ms).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`fc_hero_text_${campaignId}`, heroText);
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [heroText, campaignId]);

  // Live auto-suggest — banner updates live client-side as user types.
  const liveSuggest = useMemo(
    () => detectArchetypeSignals(heroText),
    [heroText],
  );

  const runFindMatches = useCallback(
    (opts?: { tab?: Tab; archetype?: Archetype; hideContacted?: boolean; minMatch?: number }) => {
      const nextTab = opts?.tab ?? tab;
      const nextArch = opts?.archetype ?? archetype;
      setToast(null);
      startTransition(async () => {
        // Lookalike tab uses a different server action — the hero text
        // doesn't matter, the algorithm reads positive signals from
        // campaign_partners directly.
        if (nextTab === "lookalike") {
          // Handled by runFindLookalikes below. Don't hit the hero scorer.
          return;
        }
        const out = await findMatches({
          heroText,
          archetype: nextArch,
          campaignId,
          limit: 10,
          tab: nextTab,
          minMatch: opts?.minMatch ?? 0,
          hideContacted: opts?.hideContacted ?? true,
        });
        if (out.ok) {
          setData(out.data);
          setSelected((prev) => {
            const stillVisible = new Set(out.data.rows.map((r) => r.investor_id));
            const next = new Set<number>();
            for (const id of prev) if (stillVisible.has(id)) next.add(id);
            return next;
          });
        } else {
          setToast({ kind: "err", message: out.error });
        }
      });
    },
    [heroText, archetype, campaignId, tab],
  );

  const runFindLookalikes = useCallback(() => {
    setToast(null);
    startLookalikeTransition(async () => {
      const out = await findLookalikes({ campaignId, limit: 10 });
      if (out.ok) {
        setLookalikeData(out.data);
        setSelected((prev) => {
          const stillVisible = new Set(out.data.rows.map((r) => r.investor_id));
          const next = new Set<number>();
          for (const id of prev) if (stillVisible.has(id)) next.add(id);
          return next;
        });
      } else {
        setToast({ kind: "err", message: out.error });
      }
    });
  }, [campaignId]);

  const onPickArchetype = useCallback(
    (next: Archetype) => {
      if (next === archetype) return;
      setArchetype(next);
      runFindMatches({ archetype: next });
    },
    [archetype, runFindMatches],
  );

  const onChangeTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      setTab(next);
      // Clear selection when changing between hero-scored tabs and
      // lookalike — the row universes are different.
      setSelected(new Set());
      if (next === "lookalike") {
        // Only fetch on first switch to this tab OR if the campaign
        // changed underneath us. We don't cache by campaignId here
        // because switching campaigns re-mounts the page.
        if (lookalikeData === null) {
          runFindLookalikes();
        }
        return;
      }
      runFindMatches({ tab: next });
    },
    [tab, runFindMatches, runFindLookalikes, lookalikeData],
  );

  const toggleSelect = useCallback((investorId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(investorId)) next.delete(investorId);
      else next.add(investorId);
      return next;
    });
  }, []);

  const onShortlist = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setToast(null);
    startShortlistTransition(async () => {
      const out = await shortlistSelected({ campaignId, investorIds: ids });
      if (out.ok) {
        setToast({
          kind: "ok",
          shortlisted: out.shortlisted.length,
          skipped: out.skipped.map((s) => ({ name: s.name, reason: s.reason })),
        });
        setSelected(new Set());
        router.refresh();
      } else {
        setToast({ kind: "err", message: out.error });
      }
    });
  }, [campaignId, selected, router]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runFindMatches();
    }
  };

  const rows = data.rows;
  const topN = Math.min(10, rows.length);
  const showAutoSuggest = liveSuggest.signals.length > 0;
  const autoSuggestDiffers = liveSuggest.suggested !== archetype;

  return (
    <section id="find-a-match" className="section" style={{ marginTop: 0 }}>
      {/* V4 `.hero` — single panel wraps textarea + button + archetype
          cards + auto-suggest banner + substrate hint (lines 915-964). */}
      <section className="hero">
        <div className="hero-title">
          What are you working on?{" "}
          <span className="accent">Tell us in plain language.</span>
        </div>
        <div className="hero-sub">
          Drop a business plan, deck, product sheet, or RFQ — or just type. We
          match into the right pool for the archetype you pick below. The
          auto-suggest reads your text live.
        </div>

        <div className="hero-input-wrap">
          <textarea
            ref={textareaRef}
            className="hero-input"
            value={heroText}
            onChange={(e) => setHeroText(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          <button
            type="button"
            className="hero-btn"
            onClick={() => runFindMatches()}
            disabled={isPending}
          >
            {isPending ? "Matching…" : "Find matches"}{" "}
            <span className="kbd">⌘↵</span>
          </button>
        </div>

        <ArchetypeRow
          archetype={archetype}
          onPick={onPickArchetype}
          pools={{ investor: data.archetypePoolSize }}
        />

        {showAutoSuggest ? (
          <AutoSuggestBanner
            detected={liveSuggest.suggested}
            signals={liveSuggest.signals}
            differs={autoSuggestDiffers}
            onOverride={() => onPickArchetype(liveSuggest.suggested)}
          />
        ) : null}

        <div className="substrate-hint">
          <span className="tag">adjacent</span>
          Semantic match uses the same embedding substrate as your Think &amp; Read
          investor briefings. Reading history flows in — the more you read on a
          fund, the stronger their thesis signal gets.
        </div>
      </section>

      {/* V4 `.conflict-banner` (lines 966-970). Renders only when the scored
          result set contains a firm in another campaign within 14 days. */}
      {data.firstConflict ? (
        <ConflictBanner
          conflict={data.firstConflict}
          currentCampaignName={campaignName}
        />
      ) : null}

      {/* V4 `.batch-bar` (lines 973-986). Sticky below topbar. */}
      <BatchBar
        selected={selected.size}
        total={topN}
        armed={selected.size > 0}
        disabled={selected.size === 0 || isShortlisting}
        onShortlist={onShortlist}
      />

      {toast ? <ToastRow toast={toast} onDismiss={() => setToast(null)} /> : null}

      {/* V4 `.results-head` (lines 988-998). */}
      <ResultsHead
        tab={tab}
        onTab={onChangeTab}
        totalScored={tab === "lookalike"
          ? (lookalikeData?.totalScored ?? 0)
          : data.totalScored}
        archetypePoolSize={data.archetypePoolSize}
        archetype={archetype}
        isLookalikePending={isLookalikePending}
        lookalikeData={lookalikeData}
        campaignName={campaignName}
      />

      {/* Lookalike mode renders a different card set — anchored on
          positive-signal investors, with gated empty state below 3. */}
      {tab === "lookalike" ? (
        <LookalikePanel
          data={lookalikeData}
          isPending={isLookalikePending}
          campaignName={campaignName}
          selected={selected}
          onToggle={toggleSelect}
        />
      ) : (
        <>
          {/* V4 `.result-card` stack (lines 1000-1140). */}
          {archetype !== "investor" ? (
            <ArchetypePoolEmpty archetype={archetype} />
          ) : rows.length === 0 ? (
            <EmptyResults />
          ) : (
            <>
              {rows.map((row) => (
                <ResultCard
                  key={row.investor_id}
                  row={row}
                  checked={selected.has(row.investor_id)}
                  onToggle={() => toggleSelect(row.investor_id)}
                />
              ))}
            </>
          )}
        </>
      )}

      {/* V4 `.walk-callout` (line 1142) — V4 markup has the <span.wc-num>
          and the text as direct children of the div, no wrapping span. */}
      {tab !== "lookalike" && rows.length > 0 && archetype === "investor" ? (
        <>
          <div className="walk-callout">
            <span className="wc-num">1</span>
            <b>Batch action: tick the top 5 cards, hit “Shortlist to approval sheet”.</b>{" "}
            That one click writes a new{" "}
            <code>260421 Outreach Summary for Stephan TF v12</code>{" "}
            sheet, updates the tracker to <b>+0 Pending approval</b>, and emails
            Stephan a preview link. Approvals come back as a reply; the{" "}
            <a href="#approval">approval section</a> below ingests them. Zero
            babysitting.
          </div>
          <p
            style={{
              textAlign: "center",
              color: "var(--text-faint)",
              fontSize: 12,
              margin: "14px 0 0 0",
            }}
          >
            + {Math.max(0, data.totalScored - topN)} more between 67–71% ·{" "}
            <a style={{ cursor: "pointer" }} onClick={() => runFindMatches({ tab })}>
              show them
            </a>
          </p>
        </>
      ) : null}
    </section>
  );
}

/* ========================================================================= */
/* ARCHETYPE ROW — V4 lines 924-952                                           */
/* ========================================================================= */

interface ArchetypeCardDef {
  key: Archetype;
  title: string;
  letter: string;
  icoClass: "inv" | "cus" | "sup";
  dirClass: "in" | "out";
  desc: React.ReactNode;
  example: (pools: PoolCounts) => React.ReactNode;
}

const ARCHETYPES: ArchetypeCardDef[] = [
  {
    key: "investor",
    title: "Investor",
    letter: "I",
    icoClass: "inv",
    dirClass: "in",
    desc: (
      <>
        You’re raising a round. Match against VCs, angels, grant bodies. You
        pitch <b>equity</b> in exchange for cash.
      </>
    ),
    example: (pools) => (
      <>
        <b>Today’s pool:</b> {pools.investor.toLocaleString("en-GB")} active
        investors &middot; 6 matching dimensions: Thesis / Stage / Geo /
        Cheque / Activity / Data.
      </>
    ),
  },
  {
    key: "customer",
    title: "Customer",
    letter: "C",
    icoClass: "cus",
    dirClass: "in",
    desc: (
      <>
        You’re selling a product or service. Match against buyers, retailers,
        end-users. You pitch <b>utility</b> — a pain solved.
      </>
    ),
    example: () => (
      <>
        <b>Today’s pool:</b> <i>— customer pool lands in a later section</i>
      </>
    ),
  },
  {
    key: "supplier",
    title: "Supplier",
    letter: "S",
    icoClass: "sup",
    dirClass: "out",
    desc: (
      <>
        You’re <b>buying</b> components, services, or capacity. Match against
        vendors. You pitch a <b>requirement</b>, they quote.
      </>
    ),
    example: () => (
      <>
        <b>Today’s pool:</b> <i>— supplier pool lands in a later section</i>
      </>
    ),
  },
];

function ArchetypeRow({
  archetype,
  onPick,
  pools,
}: {
  archetype: Archetype;
  onPick: (a: Archetype) => void;
  pools: PoolCounts;
}) {
  return (
    <div className="arch-row">
      {ARCHETYPES.map((a) => {
        const active = a.key === archetype;
        return (
          <div
            key={a.key}
            className={`arch-card${active ? " active" : ""}`}
            data-arch={a.title}
            onClick={() => onPick(a.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(a.key);
              }
            }}
            aria-pressed={active}
          >
            <div className="arch-head">
              <span className={`arch-ico ${a.icoClass}`}>{a.letter}</span>
              <span className="arch-title">{a.title}</span>
              <span className={`arch-dir ${a.dirClass}`}>
                money {a.dirClass}
              </span>
            </div>
            <div className="arch-desc">{a.desc}</div>
            <div className="arch-example">{a.example(pools)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================= */
/* AUTO-SUGGEST BANNER — V4 lines 954-958                                     */
/* ========================================================================= */

function AutoSuggestBanner({
  detected,
  signals,
  differs,
  onOverride,
}: {
  detected: Archetype;
  signals: string[];
  differs: boolean;
  onOverride: () => void;
}) {
  const label =
    detected === "investor" ? "Investor" : detected === "customer" ? "Customer" : "Supplier";
  const signalsText = signals.map((s) => `“${s}”`).join(", ");
  return (
    <div className="arch-suggest">
      <span className="as-ico">✓</span>
      <span>
        Auto-suggested archetype from your text: <b>{label}</b> &middot; signal
        words detected: <span>{signalsText}</span>.
      </span>
      {differs ? (
        <span className="as-link" onClick={onOverride} role="button" tabIndex={0}>
          Override →
        </span>
      ) : (
        <span className="as-link" style={{ visibility: "hidden" }}>
          Override →
        </span>
      )}
    </div>
  );
}

/* ========================================================================= */
/* CONFLICT BANNER — V4 lines 966-970                                         */
/* ========================================================================= */

function ConflictBanner({
  conflict,
  currentCampaignName,
}: {
  conflict: NonNullable<GetMatchScoreResult["firstConflict"]>;
  currentCampaignName: string;
}) {
  const statusFrag = conflict.other_status_code
    ? `at ${conflict.other_status_code}${conflict.other_status_label ? " " + conflict.other_status_label : ""}${
        conflict.days_since !== null ? ` (${conflict.days_since}d)` : ""
      }`
    : "in the last 14 days";
  return (
    <section className="conflict-banner">
      <div className="cb-icon">!</div>
      <div>
        <b>Conflict: {conflict.firm_name}</b> is already in{" "}
        <b>{conflict.other_campaign_name}</b> {statusFrag}.
        {conflict.primary_contact_name
          ? ` Adding them to ${currentCampaignName} risks a double-ask from ${conflict.primary_contact_name} in the same 14-day window.`
          : ` Adding them to ${currentCampaignName} risks a double-ask in the same 14-day window.`}
      </div>
      <div className="cb-link">Review conflict →</div>
    </section>
  );
}

/* ========================================================================= */
/* BATCH BAR — V4 lines 973-986                                               */
/* ========================================================================= */

function BatchBar({
  selected,
  total,
  armed,
  disabled,
  onShortlist,
}: {
  selected: number;
  total: number;
  armed: boolean;
  disabled: boolean;
  onShortlist: () => void;
}) {
  return (
    <div className={`batch-bar${armed ? " armed" : ""}`}>
      <div className="bb-sel">
        <span className={`bb-chk${armed ? " on" : ""}`}>{armed ? "✓" : ""}</span>
        <span className="bb-label">Selected</span>
        <span className="bb-count">{selected}</span>
        <span className="bb-label">of {total}</span>
      </div>
      <span style={{ color: "var(--text-faint)" }}>&middot;</span>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Match score &ge; <b style={{ color: "var(--text)" }}>70%</b>{" "}
        &middot; already-contacted hidden
      </span>
      <span className="bb-spacer" />
      <button className="bb-btn" disabled title="Coming in a later section">
        Add to shortlist
      </button>
      <button className="bb-btn" disabled title="Coming in a later section">
        Export to CSV
      </button>
      <button
        className="bb-btn primary"
        onClick={onShortlist}
        disabled={disabled}
      >
        Shortlist to approval sheet →
      </button>
    </div>
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast:
    | { kind: "ok"; shortlisted: number; skipped: Array<{ name: string; reason: string }> }
    | { kind: "err"; message: string };
  onDismiss: () => void;
}) {
  const isOk = toast.kind === "ok";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        border: `1px solid ${isOk ? "#bbf7d0" : "#fecaca"}`,
        background: isOk ? "var(--green-light)" : "var(--red-light)",
        color: isOk ? "var(--green)" : "var(--red)",
        fontSize: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        {isOk ? (
          <>
            <div style={{ fontWeight: 600 }}>
              Shortlisted {toast.shortlisted}{" "}
              {toast.shortlisted === 1 ? "investor" : "investors"}. Pending approval on the tracker.
            </div>
            {toast.skipped.length > 0 ? (
              <ul style={{ margin: "6px 0 0 0", padding: 0, listStyle: "none", color: "var(--text-dim)", fontSize: 11 }}>
                {toast.skipped.map((s, i) => (
                  <li key={i}>
                    Skipped <span style={{ fontWeight: 500 }}>{s.name}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <div>
            <span style={{ fontWeight: 600 }}>Could not shortlist.</span>{" "}
            {toast.message}
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
      >
        ×
      </button>
    </div>
  );
}

/* ========================================================================= */
/* RESULTS HEAD — V4 lines 988-998                                            */
/* ========================================================================= */

function ResultsHead({
  tab,
  onTab,
  totalScored,
  archetypePoolSize,
  archetype,
  isLookalikePending,
  lookalikeData,
  campaignName,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  totalScored: number;
  archetypePoolSize: number;
  archetype: Archetype;
  isLookalikePending: boolean;
  lookalikeData: LookalikeResult | null;
  campaignName: string;
}) {
  const poolLabel =
    archetype === "investor" ? archetypePoolSize.toLocaleString("en-GB") : "—";
  const scoredLabel = totalScored.toLocaleString("en-GB");
  const isLookalike = tab === "lookalike";
  const anchorCount = lookalikeData?.anchorCount ?? 0;
  return (
    <div className="results-head">
      <div>
        <div className="results-title">
          {isLookalike ? (
            <>
              Investors like the {anchorCount > 0 ? anchorCount : ""} who
              replied to <b>{campaignName}</b>
              {anchorCount >= MIN_LOOKALIKE_ANCHORS ? (
                <span className="count">
                  {" "}
                  &middot; top {Math.min(10, totalScored)} of {scoredLabel} scored
                </span>
              ) : null}
            </>
          ) : (
            <>
              Matched investors{" "}
              <span className="count">
                &middot; top {Math.min(10, totalScored)} of {scoredLabel} scored
              </span>
            </>
          )}
        </div>
        <div className="section-sub">
          {isLookalike ? (
            <>
              Scored against the aggregate thesis signal of positive
              respondents. {isLookalikePending ? "Scoring…" : "Already-contacted firms hidden."}
            </>
          ) : (
            <>
              Already-contacted firms hidden by default &middot;{" "}
              <a>show all {poolLabel}</a> &middot; <a>re-score with new pool</a>
            </>
          )}
        </div>
      </div>
      <div className="results-sort">
        <button className={tab === "best" ? "active" : ""} onClick={() => onTab("best")}>
          Best match
        </button>
        <button className={tab === "thesis" ? "active" : ""} onClick={() => onTab("thesis")}>
          Thesis only
        </button>
        <button className={tab === "near_miss" ? "active" : ""} onClick={() => onTab("near_miss")}>
          Near-miss
        </button>
        <button
          className={tab === "lookalike" ? "active" : ""}
          onClick={() => onTab("lookalike")}
          title="Investors similar to those who already replied on this campaign"
        >
          Lookalikes
        </button>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* RESULT CARD — V4 lines 1000-1140                                           */
/* ========================================================================= */

function ResultCard({
  row,
  checked,
  onToggle,
}: {
  row: MatchResultRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`result-card${checked ? " checked" : ""}`}
      data-card={row.investor_id}
    >
      <div className="rc-chk-col">
        <span
          className={`rc-chk${checked ? " on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {checked ? "✓" : ""}
        </span>
      </div>
      <div className="rc-body" onClick={onToggle}>
        <div className="result-top">
          <div className="result-headline">
            <div className="result-name">
              <span className="firm">{row.firm_name ?? "—"}</span>
              <TagChips row={row} />
            </div>
            <div className="result-meta">
              {row.hq_location ?? <i style={{ color: "var(--text-faint)" }}>HQ unknown</i>}
              <span className="sep">&middot;</span>
              {row.fund_size_raw ? (
                <>{formatRawAmount(row.fund_size_raw)} fund</>
              ) : (
                <i style={{ color: "var(--text-faint)" }}>fund size unknown</i>
              )}
              {row.sector_focus ? (
                <>
                  <span className="sep">&middot;</span>
                  {row.sector_focus}
                </>
              ) : null}
              <span className="sep">&middot;</span>
              {row.partner_count} {row.partner_count === 1 ? "partner" : "partners"}
            </div>
          </div>
          <div className="result-score">
            <div className="score-pct">{row.match}%</div>
            <div className="score-label">Match</div>
          </div>
        </div>

        {row.near_miss ? (
          <div className="near-miss">
            <b>{row.near_miss.headline}</b> {row.near_miss.body}
          </div>
        ) : null}

        <ScoreCard dims={row.dims} />

        <div className="result-tags">
          <ResultTagRow row={row} />
        </div>
      </div>
    </div>
  );
}

function TagChips({ row }: { row: MatchResultRow }) {
  const out: React.ReactNode[] = [];
  if (row.on_current_campaign?.code) {
    const code = row.on_current_campaign.code;
    const kind =
      code.startsWith("-")
        ? "tag-blocked"
        : code === "+0"
          ? "tag-warn"
          : "tag-approved";
    out.push(
      <span key="cur" className={`tag-chip ${kind}`}>
        <span className="dot" />
        {code} {row.on_current_campaign.label ?? ""}
        {row.on_current_campaign.days !== null
          ? ` · ${row.on_current_campaign.days}d`
          : ""}
      </span>,
    );
  }
  if (row.on_other_campaign) {
    out.push(
      <span key="oth" className="tag-chip tag-warn">
        <span className="dot" />
        In {row.on_other_campaign.other_campaign_name} campaign
      </span>,
    );
  }
  if (
    row.primary_partner?.email_tier !== "corresponded" &&
    row.primary_partner?.email_tier !== "hunter_verified" &&
    row.verified_email_count === 0
  ) {
    out.push(
      <span key="gate" className="tag-chip tag-blocked">
        <span className="dot" />
        Email gate — unverified
      </span>,
    );
  }
  return <>{out}</>;
}

function ResultTagRow({ row }: { row: MatchResultRow }) {
  return (
    <>
      {row.verified_email_count > 0 ? (
        <span className="tag-chip">
          <span>✉</span>
          {row.verified_email_count} verified{" "}
          {row.verified_email_count === 1 ? "email" : "emails"}
        </span>
      ) : (
        <span className="tag-chip tag-blocked">
          <span className="dot" />0 verified emails &middot; cannot advance
        </span>
      )}
      {row.last_contact_days !== null ? (
        <span className="tag-chip">
          <span>▶</span>Last touched {row.last_contact_days}
          {row.last_contact_days === 1 ? " day" : " days"} ago
        </span>
      ) : null}
      {row.primary_partner?.name ? (
        <span className="tag-chip">
          <span>↳</span>
          {row.primary_partner.name}
          {row.primary_partner.title ? ` · ${row.primary_partner.title}` : ""}
        </span>
      ) : null}
      {row.verified_email_count === 0 ? (
        <span className="tag-chip tag-warn">
          <span>⚠</span>Resolve email →
        </span>
      ) : null}
    </>
  );
}

/* ========================================================================= */
/* SCORECARD — V4 lines 1014-1021                                             */
/* ========================================================================= */

const DIM_ORDER: Array<{ key: keyof ScoreDims; label: string }> = [
  { key: "thesis", label: "Thesis" },
  { key: "stage", label: "Stage" },
  { key: "geo", label: "Geo" },
  { key: "cheque", label: "Cheque" },
  { key: "activity", label: "Activity" },
  { key: "data", label: "Data" },
];

function ScoreCard({ dims }: { dims: ScoreDims }) {
  return (
    <div className="scorecard">
      {DIM_ORDER.map((d) => {
        const v = dims[d.key];
        const bandCls = v >= 80 ? "d-hi" : v >= 60 ? "d-md" : "d-lo";
        return (
          <div key={d.key} className={`dim ${bandCls}`}>
            <div className="dim-lbl">{d.label}</div>
            <div className="dim-bar">
              <div className="dim-fill" style={{ width: `${v}%` }} />
            </div>
            <div className="dim-val">{v}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================= */
/* EMPTY STATES                                                               */
/* ========================================================================= */

function EmptyResults() {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
        No matches yet.
      </div>
      <p
        style={{
          margin: "6px auto 0 auto",
          maxWidth: 420,
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        Add more detail to your pitch text above and press Find matches. Nightly
        sync runs at 06:00 BST — if the mirror is empty no scores will land.
      </p>
    </div>
  );
}

function ArchetypePoolEmpty({ archetype }: { archetype: Archetype }) {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        background: "var(--surface-alt)",
        border: "1px dashed var(--border)",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
        {archetype === "customer" ? "Customer" : "Supplier"} pool lands in a later section.
      </div>
      <p
        style={{
          margin: "6px auto 0 auto",
          maxWidth: 420,
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        Switch to <b>Investor</b> above to see the live investor pool, or wait
        for the next Forge Capital pipeline release to populate the {archetype}{" "}
        mirror.
      </p>
    </div>
  );
}

/* ========================================================================= */
/* Helpers                                                                    */
/* ========================================================================= */

/**
 * Format a raw text value from `investors_mirror.fund_size_usd` /
 * `cheque_min_usd` / `cheque_max_usd` into a short display string.
 *
 * Migration 009 relaxed these columns to TEXT so the pipeline can store
 * mixed formats — numeric strings ("30000000.0") or human strings
 * ("~$1,080,000 (€1M in seed round)"). For V1 we detect the "pure numeric"
 * case and collapse to $30M etc.; anything with a currency symbol already
 * passes through untouched.
 */
function formatRawAmount(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (/[€£$~]/.test(trimmed) || /\b(m|M|b|B|k|K)\b/.test(trimmed)) {
    return trimmed;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return trimmed;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toFixed(0)}`;
}

/* ========================================================================= */
/* LOOKALIKE PANEL — rendered when tab === "lookalike"                        */
/* ========================================================================= */

function LookalikePanel({
  data,
  isPending,
  campaignName,
  selected,
  onToggle,
}: {
  data: LookalikeResult | null;
  isPending: boolean;
  campaignName: string;
  selected: Set<number>;
  onToggle: (investorId: number) => void;
}) {
  if (data === null && isPending) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "40px 20px",
          color: "var(--text-dim)",
          fontSize: 13,
        }}
      >
        Scoring the pool against the respondent signature…
      </div>
    );
  }
  if (data === null) {
    // Transition hasn't started — never reachable in practice because
    // onChangeTab kicks off the fetch immediately. Defensive render.
    return null;
  }

  const gated = data.anchorCount < MIN_LOOKALIKE_ANCHORS;

  return (
    <>
      {/* Anchor strip — shows which respondents the algorithm is
          projecting from. Same visual vocabulary as result tag chips
          so it sits naturally below the results head. */}
      {data.anchors.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "10px 14px",
            margin: "0 0 10px 0",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--surface-alt)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text-dim)", marginRight: 4 }}>
            Based on {data.anchorCount} respondent
            {data.anchorCount === 1 ? "" : "s"}:
          </span>
          {data.anchors.map((a) => (
            <AnchorChip key={a.investor_id} anchor={a} />
          ))}
        </div>
      ) : null}

      {gated ? (
        <div
          style={{
            padding: "32px 22px",
            border: "1px dashed var(--border)",
            borderRadius: 12,
            background: "var(--surface-alt)",
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
            Not enough respondents yet for lookalikes.
          </div>
          <div>
            {campaignName} has {data.anchorCount} positive signal
            {data.anchorCount === 1 ? "" : "s"} on file. Need at least{" "}
            {MIN_LOOKALIKE_ANCHORS} before projecting a thesis signature —
            one or two responses are too narrow to generalise from.
          </div>
          <div style={{ marginTop: 10, color: "var(--text-faint)", fontSize: 12 }}>
            Positive signal = status <code>+6</code> (reply) through{" "}
            <code>+12</code> (committed). Lookalikes activate automatically
            once more responses land.
          </div>
        </div>
      ) : data.rows.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "var(--text-dim)",
            fontSize: 13,
          }}
        >
          Scored {data.totalScored} investors but none overlap strongly enough
          with the respondents&rsquo; signature. Try re-syncing the pool or
          tightening the thesis text on the current respondents.
        </div>
      ) : (
        <>
          {data.rows.map((row) => (
            <LookalikeCard
              key={row.investor_id}
              row={row}
              checked={selected.has(row.investor_id)}
              onToggle={() => onToggle(row.investor_id)}
            />
          ))}
        </>
      )}
    </>
  );
}

function AnchorChip({ anchor }: { anchor: LookalikeAnchor }) {
  const label = anchor.status_label ?? anchor.status_code;
  return (
    <span
      className="tag-chip tag-approved"
      title={`${label} — weight ${anchor.weight}`}
      style={{ fontWeight: 600 }}
    >
      {anchor.firm_name}{" "}
      <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>
        · {anchor.status_code}
      </span>
    </span>
  );
}

function LookalikeCard({
  row,
  checked,
  onToggle,
}: {
  row: LookalikeRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`result-card${checked ? " checked" : ""}`}
      data-card={row.investor_id}
    >
      <div className="rc-chk-col">
        <span
          className={`rc-chk${checked ? " on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          role="checkbox"
          aria-checked={checked}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {checked ? "✓" : ""}
        </span>
      </div>
      <div className="rc-body">
        <div className="result-top">
          <div className="result-headline">
            <div className="result-name">
              <span className="firm">{row.firm_name}</span>
            </div>
            <div className="result-meta">
              {row.hq_location ? <span>{row.hq_location}</span> : null}
              {row.sector_focus ? (
                <>
                  <span className="sep">·</span>
                  <span>{row.sector_focus.split(",").slice(0, 3).join(", ")}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="result-score">
            <div className="score-pct">{row.match_score}%</div>
            <div className="score-label">lookalike</div>
          </div>
        </div>
        {/* Reason — why this one surfaced. Uses V4's `.near-miss` chrome
            because the visual weight is right: it's a callout, not a
            warning. */}
        <div className="near-miss" style={{ borderLeftColor: "var(--accent)" }}>
          {row.reason}
        </div>
        {row.thesis_summary ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.55,
              marginTop: 4,
            }}
          >
            {row.thesis_summary.length > 240
              ? row.thesis_summary.slice(0, 240).trim() + "…"
              : row.thesis_summary}
          </div>
        ) : null}
      </div>
    </div>
  );
}
