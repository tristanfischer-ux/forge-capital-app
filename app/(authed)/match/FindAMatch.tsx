"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Archetype,
  GetMatchScoreResult,
  MatchResultRow,
  ScoreDims,
} from "@/lib/queries/match-score-types";
import { detectArchetypeSignals } from "@/lib/queries/match-score-types";
import { findMatches, findLookalikes, shortlistSelected } from "./match-v4-actions";
import { heroTextForArchetype } from "./match-constants";
import { CustomerPartnerCards } from "./CustomerPartnerCards";
import type { CustomerCampaignPartnerCard } from "@/lib/queries/customer-partners";
// NOTE: EmailHuntModal is now mounted at the authed shell level
// (`app/(authed)/layout.tsx`) so the verification-gate buttons and
// any future surface can also dispatch `fc:resolve-email`. The modal
// subscribes to the same window event — no contract change here.
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
  /** Customer-side partner cards — rendered in place of the
   *  pool-empty placeholder when archetype === "customer". Null on
   *  investor / supplier campaigns. */
  customerPartners?: CustomerCampaignPartnerCard[] | null;
}

type Tab = "best" | "thesis" | "near_miss" | "lookalike";
type SortBy = "match" | "alphabetical" | "approval" | "recent_contact";

/**
 * Page size for the matched-investor list. Default 25 (was 10 pre-
 * 2026-04-22 enhancement wave). Tristan wants fuller visibility into the
 * 9,349-strong pool; the server scores a 2,000-row candidate pool and
 * client-side Load-more appends successive pages by asking for a bigger
 * `limit` on the next server call.
 */
const PAGE_SIZE = 25;

/**
 * Client-side filter row — sits between the hero and the results head.
 * All filters are applied AFTER scoring. Future step: push these into
 * the server-side scorer so they prune the candidate pool instead of
 * trimming the displayed rows.
 */
type StageFilter = "any" | "pre-seed" | "seed" | "series-a" | "series-b" | "growth";
type GeoFilter = "any" | "uk" | "eu" | "us" | "global";
type TypeFilter = "any" | "vc" | "accelerator" | "grant" | "corporate" | "angel";
type ChequeFilter = "any" | "lt500k" | "500k-2m" | "2m-10m" | "10m-plus";

interface Filters {
  stage: StageFilter;
  geo: GeoFilter;
  type: TypeFilter;
  cheque: ChequeFilter;
}

const DEFAULT_FILTERS: Filters = {
  stage: "any",
  geo: "any",
  type: "any",
  cheque: "any",
};

// Approval-status ranking: lower number sorts first. Any positive status
// code (+1, +2, ...) means the counterpart greenlit the row — those come
// first; then pending (+0); then rejected/archived; then rows that have
// never touched this campaign. Rows currently on this campaign have a
// non-null `on_current_campaign`; we read its status_code there.
const APPROVAL_RANK: Record<string, number> = {
  "+12": 0, "+11": 0, "+10": 0, "+9": 0, "+8": 0, "+7": 0,
  "+6": 0, "+5": 0, "+4": 0, "+3": 0, "+2": 0, "+1": 0,
  "+0": 1,
  "-3": 2,
};

function approvalRank(
  row: GetMatchScoreResult["rows"][number],
): number {
  const code = row.on_current_campaign?.code ?? null;
  if (code && APPROVAL_RANK[code] !== undefined) return APPROVAL_RANK[code];
  if (code) return 3; // any other status code — still on the campaign
  return 4; // not on the campaign at all
}

function sortRows(
  rows: GetMatchScoreResult["rows"],
  by: SortBy,
): GetMatchScoreResult["rows"] {
  if (by === "match") return rows; // server already ranked by score/tab
  const out = [...rows];
  if (by === "alphabetical") {
    out.sort((a, b) =>
      (a.firm_name ?? "").localeCompare(b.firm_name ?? "", "en-GB", {
        sensitivity: "base",
      }),
    );
  } else if (by === "approval") {
    out.sort((a, b) => {
      const ra = approvalRank(a);
      const rb = approvalRank(b);
      if (ra !== rb) return ra - rb;
      return b.match - a.match; // tie-break by match score
    });
  } else if (by === "recent_contact") {
    out.sort((a, b) => {
      const da = a.last_contact_days;
      const db = b.last_contact_days;
      // never-contacted rows sink to the bottom
      if (da === null && db === null) return b.match - a.match;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db; // smaller days-ago = more recent = first
    });
  }
  return out;
}

interface PoolCounts {
  investor: number;
}

/**
 * Apply the client-side filter row to a scored row set. Each filter
 * degrades to "match anything" when set to "any". Geography is read from
 * `geo_focus + hq_location`; cheque uses the already-parsed raw strings
 * from `cheque_min_raw / cheque_max_raw`. Type is heuristic until a
 * proper `investor_type` column lands in `investors_mirror`.
 */
function applyFilters(
  rows: GetMatchScoreResult["rows"],
  f: Filters,
): GetMatchScoreResult["rows"] {
  if (
    f.stage === "any" &&
    f.geo === "any" &&
    f.type === "any" &&
    f.cheque === "any"
  ) {
    return rows;
  }
  return rows.filter((r) => {
    if (f.stage !== "any") {
      const sf = (r.stage_focus ?? "").toLowerCase();
      const wanted =
        f.stage === "pre-seed" ? /pre-?seed/ :
        f.stage === "seed" ? /\bseed\b/ :
        f.stage === "series-a" ? /series\s*a/ :
        f.stage === "series-b" ? /series\s*b/ :
        f.stage === "growth" ? /growth|late|series\s*c|series\s*d/ :
        null;
      if (wanted && !wanted.test(sf)) return false;
    }
    if (f.geo !== "any") {
      const gf = `${r.geo_focus ?? ""} ${r.hq_location ?? ""}`.toLowerCase();
      const wanted =
        f.geo === "uk" ? /uk|united kingdom|britain|london|england/ :
        f.geo === "eu" ? /eu|europe|germany|france|spain|italy|netherlands/ :
        f.geo === "us" ? /\bus\b|usa|united states|america|california|new york/ :
        f.geo === "global" ? /global|worldwide/ :
        null;
      if (wanted && !wanted.test(gf)) return false;
    }
    if (f.type !== "any") {
      // Heuristic — no dedicated investor_type column yet. Match against
      // firm_name + sector_focus. "Angel" rarely in firm_name so it
      // relies on single-partner fund structure.
      const blob =
        `${r.firm_name ?? ""} ${r.sector_focus ?? ""}`.toLowerCase();
      if (f.type === "accelerator" && !/accelerator|incubator|y ?combinator|techstars/.test(blob)) return false;
      if (f.type === "grant" && !/grant|innovate uk|horizon europe|arpa|doe|darpa|nsf/.test(blob)) return false;
      if (f.type === "corporate" && !/corporate|ventures|strategic/.test(blob)) return false;
      if (f.type === "angel" && !(r.partner_count === 1 || /angel/.test(blob))) return false;
      if (f.type === "vc") {
        if (/accelerator|incubator|grant|angel/.test(blob)) return false;
        // VC is the default-shape assumption — anything not an accelerator /
        // grant / angel passes through.
      }
    }
    if (f.cheque !== "any") {
      const min = parseApproxAmount(r.cheque_min_raw);
      const max = parseApproxAmount(r.cheque_max_raw);
      if (min === null && max === null) return false;
      const lo = min ?? 0;
      const hi = max ?? Number.POSITIVE_INFINITY;
      const [fLo, fHi] =
        f.cheque === "lt500k" ? [0, 500_000] :
        f.cheque === "500k-2m" ? [500_000, 2_000_000] :
        f.cheque === "2m-10m" ? [2_000_000, 10_000_000] :
        f.cheque === "10m-plus" ? [10_000_000, Number.POSITIVE_INFINITY] :
        [0, Number.POSITIVE_INFINITY];
      // Overlap test.
      if (!(lo <= fHi && hi >= fLo)) return false;
    }
    return true;
  });
}

/**
 * Lightweight amount parser — handles "$30M", "€1.5m", "~£500k", "2000000".
 * Returns null when nothing numeric can be extracted. Kept separate from
 * the server's parser (which is richer) because the client doesn't ship
 * the full match-score internals.
 */
function parseApproxAmount(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[, ~]/g, "");
  const m = s.match(/([€£$]?)([\d.]+)\s*([kmb]?)/);
  if (!m) return null;
  const base = parseFloat(m[2]);
  if (!Number.isFinite(base)) return null;
  const unit = m[3];
  const mult = unit === "b" ? 1e9 : unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1;
  return base * mult;
}

export function FindAMatch({
  campaignId,
  campaignName,
  initialData,
  initialArchetype,
  customerPartners,
}: FindAMatchProps) {
  const router = useRouter();

  const [heroText, setHeroText] = useState<string>(
    heroTextForArchetype(initialArchetype),
  );
  const [archetype, setArchetype] = useState<Archetype>(initialArchetype);
  const [data, setData] = useState<GetMatchScoreResult>(initialData);
  const [tab, setTab] = useState<Tab>("best");
  // Secondary order applied client-side over the tab-filtered rows. The
  // tab chooses WHICH rows (best / thesis-only / near-miss / lookalike);
  // sortBy chooses HOW they're ordered within that set. "match" is the
  // default — keep the server's ranking untouched.
  const [sortBy, setSortBy] = useState<SortBy>("match");
  // Filter row — client-side until server-side filtering lands.
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // "New only" hides already-contacted firms (default). "Show all"
  // flips the server's hideContacted flag so the full pool shows,
  // including firms already on this campaign.
  const [showAll, setShowAll] = useState<boolean>(false);
  // Pagination — client increments the visible count, then when we hit
  // the rows we already fetched from the server we ask the server for
  // more. `requestedLimit` tracks the highest limit we've asked the
  // server for.
  const [requestedLimit, setRequestedLimit] = useState<number>(PAGE_SIZE);
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Single-click expands a result card inline; double-click navigates to
  // the full `/investor/[id]` profile. At most one card is expanded at a
  // time — click a second card and the first collapses.
  const [expandedId, setExpandedId] = useState<number | null>(null);
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

  // Sync client state to server-rendered props when the server
  // re-renders with a different campaign. useState(initialX) only
  // reads the prop on mount — switching campaigns via the top-bar
  // gives us new props but leaves the client state stale. 2026-04-24:
  // Tristan switched Fischer Farms Customer → SkySails Power and the
  // archetype card stayed highlighted on Customer with the Fischer
  // Farms seed text in the box AND stale Matched-customers cards.
  // Three pieces of state need to follow initialArchetype/initialData:
  //   (1) archetype
  //   (2) the scored `data` (for investor archetype)
  //   (3) hero text + selected + lookalike (handled by the
  //       campaignId effect below)
  useEffect(() => {
    setArchetype(initialArchetype);
  }, [initialArchetype]);
  useEffect(() => {
    setData(initialData);
    setTab("best");
    setRequestedLimit(PAGE_SIZE);
    setVisibleCount(PAGE_SIZE);
  }, [initialData]);

  // Hero text must follow the active campaign + its archetype.
  // Previous bugs:
  //   (a) switching SkySails → FishFrom left stale SkySails text
  //       because we only loaded from localStorage when something
  //       was stored — never cleared.
  //   (b) switching investor → customer campaign left the SkySails
  //       investor pitch in place (Tristan 2026-04-24) because the
  //       fallback default was hard-coded investor-shaped.
  //   (c) switching Fischer Farms Customer → SkySails left the
  //       Fischer Farms container text + customer archetype
  //       (2026-04-24) because the client state was pinned at
  //       mount (see the sync effect above).
  // Now we always set the text when campaignId OR archetype changes:
  // stored value if present, else the archetype-appropriate default.
  useEffect(() => {
    const key = `fc_hero_text_${campaignId}_${archetype}`;
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(key)
        : null;
    setHeroText(
      stored && stored.trim().length > 0
        ? stored
        : heroTextForArchetype(archetype),
    );
    // Reset the scored data set — previously-scored rows are from the
    // old campaign's text, not the new one, and rendering stale rows
    // under a new campaign name is the class of "seeing the same
    // matches" bug Tristan flagged.
    setSelected(new Set());
    setLookalikeData(null);
  }, [campaignId, archetype]);

  // Persist hero text (debounced at 500ms).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `fc_hero_text_${campaignId}_${archetype}`,
          heroText,
        );
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [heroText, campaignId, archetype]);

  // Live auto-suggest — banner updates live client-side as user types.
  const liveSuggest = useMemo(
    () => detectArchetypeSignals(heroText),
    [heroText],
  );

  const runFindMatches = useCallback(
    (opts?: {
      tab?: Tab;
      archetype?: Archetype;
      hideContacted?: boolean;
      minMatch?: number;
      /** Override the requested limit (defaults to PAGE_SIZE to reset). */
      limit?: number;
    }) => {
      const nextTab = opts?.tab ?? tab;
      const nextArch = opts?.archetype ?? archetype;
      const nextHideContacted = opts?.hideContacted ?? !showAll;
      const nextLimit = opts?.limit ?? PAGE_SIZE;
      setToast(null);
      // Reset pagination whenever a fresh query kicks off.
      setRequestedLimit(nextLimit);
      setVisibleCount(nextLimit);
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
          limit: nextLimit,
          tab: nextTab,
          minMatch: opts?.minMatch ?? 0,
          hideContacted: nextHideContacted,
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
    [heroText, archetype, campaignId, tab, showAll],
  );

  /**
   * Load-more handler — expose one more PAGE_SIZE page. If the server
   * already handed us enough scored rows we just widen the visible
   * window; otherwise we re-request with a bigger limit.
   */
  const loadMore = useCallback(() => {
    const nextVisible = visibleCount + PAGE_SIZE;
    // If the server already has these rows in the current payload, no
    // round-trip needed.
    if (data.rows.length >= nextVisible) {
      setVisibleCount(nextVisible);
      return;
    }
    // Lookalike has its own pager path (V1 doesn't paginate lookalikes
    // yet — the algorithm surfaces top-10 against the respondent
    // signature and the overlap curve drops off quickly after). Skip
    // the server round-trip for that tab.
    if (tab === "lookalike") {
      setVisibleCount(nextVisible);
      return;
    }
    const scoredTab: "best" | "thesis" | "near_miss" = tab;
    // Otherwise ask the server for a wider slice. Cap at the total
    // scored pool so we don't push requestedLimit into the stratosphere
    // on small result sets.
    const nextRequested = Math.min(
      Math.max(nextVisible, requestedLimit + PAGE_SIZE),
      data.totalScored,
    );
    setRequestedLimit(nextRequested);
    startLoadMoreTransition(async () => {
      const out = await findMatches({
        heroText,
        archetype,
        campaignId,
        limit: nextRequested,
        tab: scoredTab,
        minMatch: 0,
        hideContacted: !showAll,
      });
      if (out.ok) {
        setData(out.data);
        setVisibleCount(nextVisible);
      } else {
        setToast({ kind: "err", message: out.error });
      }
    });
  }, [
    visibleCount,
    data.rows.length,
    data.totalScored,
    requestedLimit,
    heroText,
    archetype,
    campaignId,
    tab,
    showAll,
  ]);

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

  const toggleExpand = useCallback((investorId: number) => {
    setExpandedId((prev) => (prev === investorId ? null : investorId));
  }, []);

  const openProfile = useCallback(
    (investorId: number) => {
      router.push(`/investor/${investorId}`);
    },
    [router],
  );

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

  // Pipeline: server-scored rows → secondary sort → client-side filters →
  // visible-window slice. Keep these as separate useMemos so a filter or
  // sort change doesn't blow away the whole ranking.
  const sortedRows = useMemo(
    () => sortRows(data.rows, sortBy),
    [data.rows, sortBy],
  );
  const filteredRows = useMemo(
    () => applyFilters(sortedRows, filters),
    [sortedRows, filters],
  );
  // "visibleRows" is what renders. Slice is over the filtered set.
  const rows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );
  const topN = rows.length;
  const hasMoreToShow = visibleCount < filteredRows.length;
  // Also true when we could ask the server for more scored rows.
  const canRequestMoreFromServer =
    !hasMoreToShow && data.rows.length < data.totalScored;
  const canLoadMore = hasMoreToShow || canRequestMoreFromServer;
  const showAutoSuggest = liveSuggest.signals.length > 0;
  const autoSuggestDiffers = liveSuggest.suggested !== archetype;

  /**
   * Pre-fill the hero textarea + filter row from a "Dump info" drop.
   * Extracted here so the floating box at the top of the section can
   * mutate the same state as the textarea and the filter selects.
   */
  const applyExtractedProfile = useCallback(
    (profile: {
      stage: string | null;
      geography: string | null;
      raise_amount: string | null;
      sectors: string[];
      description: string | null;
    }) => {
      // Textarea: use the description if we have one, else a synthesised
      // one-liner so Find-matches has SOMETHING to score.
      if (profile.description && profile.description.trim().length > 0) {
        setHeroText(profile.description.trim());
      } else {
        const bits: string[] = [];
        if (profile.raise_amount) bits.push(`Raising ${profile.raise_amount}`);
        if (profile.stage) bits.push(`at ${profile.stage}`);
        if (profile.sectors.length > 0) bits.push(`in ${profile.sectors.join(", ")}`);
        if (profile.geography) bits.push(`(${profile.geography})`);
        const line = bits.join(" ").trim();
        if (line) setHeroText(line + ".");
      }

      // Filter row: only overwrite when we have a strong match — we
      // don't want Haiku's "Pre-seed/Seed" hedge to clobber a user's
      // explicit Series A choice.
      setFilters((prev) => {
        const next: Filters = { ...prev };
        const stageKey = profile.stage?.toLowerCase() ?? "";
        if (stageKey.includes("pre-seed") || stageKey.includes("pre seed"))
          next.stage = "pre-seed";
        else if (stageKey === "seed") next.stage = "seed";
        else if (stageKey.includes("series a")) next.stage = "series-a";
        else if (stageKey.includes("series b")) next.stage = "series-b";
        else if (stageKey.includes("growth")) next.stage = "growth";

        const geoKey = profile.geography?.toLowerCase() ?? "";
        if (geoKey === "uk" || geoKey === "united kingdom") next.geo = "uk";
        else if (geoKey === "eu" || geoKey === "europe") next.geo = "eu";
        else if (geoKey === "us" || geoKey === "united states") next.geo = "us";
        else if (geoKey === "global") next.geo = "global";

        const raise = profile.raise_amount ?? "";
        const raiseNum = parseApproxAmount(
          raise
            .replace(/[€£$]/g, "")
            .split(/[–\-to]+/)[0] ?? "",
        );
        if (raiseNum !== null) {
          if (raiseNum < 500_000) next.cheque = "lt500k";
          else if (raiseNum < 2_000_000) next.cheque = "500k-2m";
          else if (raiseNum < 10_000_000) next.cheque = "2m-10m";
          else next.cheque = "10m-plus";
        }

        return next;
      });
    },
    [],
  );

  return (
    <section id="find-a-match" className="section" style={{ marginTop: 0 }}>
      {/* Dump-info drop zone — above the hero. Drag any deck/email/bio
          snippet and Haiku pre-fills the hero textarea AND the filter
          row. Degrades to "paste into textarea" if no Haiku key. */}
      <DumpInfoBox onProfile={applyExtractedProfile} setHeroText={setHeroText} />

      {/* V4 `.hero` — single panel wraps textarea + button + archetype
          cards + auto-suggest banner + substrate hint (lines 915-964). */}
      <section className="hero">
        <div className="hero-title">
          What are you working on?{" "}
          <span className="accent">Pick an archetype, then tell us about it.</span>
        </div>
        <div className="hero-sub">
          Choose whether you&rsquo;re raising, selling, or sourcing — that
          determines the pool we match against. Then drop a business plan,
          deck, product sheet, or RFQ (or just type) below. Auto-suggest
          reads your text live.
        </div>

        <ArchetypeRow
          archetype={archetype}
          onPick={onPickArchetype}
          pools={{ investor: data.archetypePoolSize }}
        />

        <PitchInput
          heroText={heroText}
          setHeroText={setHeroText}
          onKeyDown={onKeyDown}
          onFindMatches={() => runFindMatches()}
          isPending={isPending}
          textareaRef={textareaRef}
          onSynthesised={applyExtractedProfile}
        />

        {showAutoSuggest ? (
          <AutoSuggestBanner
            detected={liveSuggest.suggested}
            signals={liveSuggest.signals}
            differs={autoSuggestDiffers}
            onOverride={() => onPickArchetype(liveSuggest.suggested)}
          />
        ) : null}

        {archetype === "investor" ? (
          <div className="substrate-hint">
            <span className="tag">adjacent</span>
            Semantic match uses the same embedding substrate as your Think &amp; Read
            investor briefings. Reading history flows in — the more you read on a
            fund, the stronger their thesis signal gets.
          </div>
        ) : null}
      </section>

      {/* Filter row — sits above the results head so the user can
          narrow the scored set before reading any card. Client-side
          (applied to the already-scored rows); server-side pruning
          lands in a future step. */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* V4 `.conflict-banner` (lines 966-970). Renders only when the scored
          result set contains a firm in another campaign within 14 days. */}
      {data.firstConflict ? (
        <ConflictBanner
          conflict={data.firstConflict}
          currentCampaignName={campaignName}
        />
      ) : null}

      {/* V4 `.batch-bar` (lines 973-986). Sticky below topbar.
          `visibleIds` drives Select-all; depends on which tab is
          active so we don't try to select rows from the other mode. */}
      <BatchBar
        selected={selected.size}
        total={
          tab === "lookalike"
            ? (lookalikeData?.rows.length ?? 0)
            : topN
        }
        armed={selected.size > 0}
        disabled={selected.size === 0 || isShortlisting}
        onShortlist={onShortlist}
        onSelectAll={() => {
          const ids =
            tab === "lookalike"
              ? (lookalikeData?.rows ?? []).map((r) => r.investor_id)
              : rows.map((r) => r.investor_id);
          setSelected(new Set(ids));
        }}
        onClearAll={() => setSelected(new Set())}
      />

      {toast ? <ToastRow toast={toast} onDismiss={() => setToast(null)} /> : null}

      {/* Instructions BEFORE the results, not after. The guidance used
          to sit below the cards, which meant you'd scroll through 10
          rows before learning how to use them. Copy is campaign-generic
          — the old V4 mockup named Stephan and hardcoded the sheet
          filename; both dropped in favour of a verb-driven explanation. */}
      {archetype === "investor" ? (
        <div className="walk-callout" style={{ marginBottom: 10 }}>
          <span className="wc-num">1</span>
          <b>How to shortlist:</b> click a card once to expand and read
          the thesis/synthesis, double-click to open the full profile,
          or tick the checkbox to select. Hit <b>Select all visible</b>{" "}
          on the batch bar to grab the whole page. When you&rsquo;re
          happy with the list, click <b>Shortlist to approval sheet →</b>
          {" "}— we write them to the tracker at{" "}
          <b>+0 Pending approval</b>, ready for the{" "}
          <a href="#approval">approval section</a>. Nothing leaves the
          app until you review and send yourself.
        </div>
      ) : null}

      {/* V4 `.results-head` (lines 988-998). */}
      <ResultsHead
        tab={tab}
        onTab={onChangeTab}
        sortBy={sortBy}
        onSortBy={setSortBy}
        totalScored={tab === "lookalike"
          ? (lookalikeData?.totalScored ?? 0)
          : data.totalScored}
        archetypePoolSize={data.archetypePoolSize}
        archetype={archetype}
        isLookalikePending={isLookalikePending}
        lookalikeData={lookalikeData}
        campaignName={campaignName}
        customerPartnersCount={customerPartners?.length ?? 0}
        showAll={showAll}
        onToggleShowAll={(next) => {
          setShowAll(next);
          runFindMatches({ hideContacted: !next });
        }}
        visibleCount={topN}
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
          expandedId={expandedId}
          onExpand={toggleExpand}
          onOpenProfile={openProfile}
        />
      ) : (
        <>
          {/* V4 `.result-card` stack (lines 1000-1140). */}
          {archetype === "customer" ? (
            customerPartners && customerPartners.length > 0 ? (
              <CustomerPartnerCards
                cards={customerPartners}
                campaignId={campaignId}
              />
            ) : (
              <ArchetypePoolEmpty archetype={archetype} campaignId={campaignId} />
            )
          ) : archetype !== "investor" ? (
            <ArchetypePoolEmpty archetype={archetype} campaignId={campaignId} />
          ) : rows.length === 0 ? (
            <EmptyResults />
          ) : (
            <>
              {rows.map((row) => (
                <ResultCard
                  key={row.investor_id}
                  row={row}
                  checked={selected.has(row.investor_id)}
                  expanded={expandedId === row.investor_id}
                  onToggle={() => toggleSelect(row.investor_id)}
                  onExpand={() => toggleExpand(row.investor_id)}
                  onOpenProfile={() => openProfile(row.investor_id)}
                />
              ))}
            </>
          )}
        </>
      )}

      {tab !== "lookalike" && rows.length > 0 && archetype === "investor" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            margin: "18px 0 0 0",
          }}
        >
          {canLoadMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore || isPending}
              style={{
                padding: "9px 20px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--accent)",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: isLoadingMore || isPending ? "wait" : "pointer",
                opacity: isLoadingMore || isPending ? 0.7 : 1,
              }}
            >
              {isLoadingMore
                ? "Loading more…"
                : `Load more (${PAGE_SIZE} more)`}
            </button>
          ) : null}
          <p
            style={{
              textAlign: "center",
              color: "var(--text-faint)",
              fontSize: 11,
              margin: 0,
            }}
          >
            {filters.stage === "any" &&
            filters.geo === "any" &&
            filters.type === "any" &&
            filters.cheque === "any"
              ? `Showing top ${topN} of ${data.totalScored.toLocaleString("en-GB")} semantic matches ranked from ${data.archetypePoolSize.toLocaleString("en-GB")} active investors (already-contacted firms hidden).`
              : `Showing ${topN} of ${filteredRows.length.toLocaleString("en-GB")} after filters · ${data.totalScored.toLocaleString("en-GB")} semantic matches from ${data.archetypePoolSize.toLocaleString("en-GB")} active investors.`}
          </p>
        </div>
      ) : null}

      {/* Email-hunt modal (#69) lifted to `app/(authed)/layout.tsx` on
          2026-04-22 so the verification-gate "Resolve email" button can
          dispatch the same `fc:resolve-email` event and have the modal
          appear without a page-specific mount. The result card's
          "Resolve email →" chip still works unchanged — dispatch
          contract is identical. */}
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
        Cheque / Activity / Confidence.
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

  // When the detected archetype matches the selected one, the banner
  // is just noise confirming the user already picked right — suppress
  // the "signal" framing. When it DIFFERS (e.g. pasting an investor
  // pitch into a customer campaign), frame it as a suggestion, NOT as
  // a declarative classification — the user's explicit selection
  // always wins. The £30K-is-an-investor-cheque heuristic fires on
  // the Fischer Farms container-rental deposit too; we can't silence
  // it but we can stop the banner pretending it's authoritative.
  if (!differs) {
    return (
      <div className="arch-suggest">
        <span className="as-ico">✓</span>
        <span>
          Your text matches the selected <b>{label}</b> archetype.
          {signals.length > 0 ? (
            <>
              {" "}
              <span style={{ color: "var(--text-faint)" }}>
                Signal words: {signalsText}.
              </span>
            </>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="arch-suggest">
      <span className="as-ico">!</span>
      <span>
        Your text reads <b>{label}</b>-shaped
        {signals.length > 0 ? (
          <>
            {" "}
            (signal words: <span>{signalsText}</span>)
          </>
        ) : null}
        , but you’re on a different archetype. Leave as-is if you
        meant the current one, or switch below.
      </span>
      <span
        className="as-link"
        onClick={onOverride}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOverride();
          }
        }}
        role="button"
        tabIndex={0}
      >
        Switch to {label} →
      </span>
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
  // Deep-link into the OTHER campaign's tracker, pre-selected. The
  // campaign switcher reads ?c=<id> so this instantly switches the
  // user's active campaign to the conflict's origin.
  const href = `/tracker?c=${encodeURIComponent(conflict.other_campaign_id)}`;
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
      <Link href={href} className="cb-link">
        Review conflict →
      </Link>
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
  onSelectAll,
  onClearAll,
}: {
  selected: number;
  total: number;
  armed: boolean;
  disabled: boolean;
  onShortlist: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const allSelected = selected > 0 && selected === total;
  return (
    <div className={`batch-bar${armed ? " armed" : ""}`}>
      <div
        className="bb-sel"
        onClick={allSelected ? onClearAll : onSelectAll}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            (allSelected ? onClearAll : onSelectAll)();
          }
        }}
        style={{ cursor: total > 0 ? "pointer" : "default" }}
        title={allSelected ? "Clear selection" : "Select all visible"}
      >
        <span className={`bb-chk${armed ? " on" : ""}`}>{armed ? "✓" : ""}</span>
        <span className="bb-label">Selected</span>
        <span className="bb-count">{selected}</span>
        <span className="bb-label">of {total}</span>
      </div>
      <span style={{ color: "var(--text-faint)" }}>&middot;</span>
      <button
        type="button"
        onClick={allSelected ? onClearAll : onSelectAll}
        disabled={total === 0}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--accent)",
          fontSize: 12,
          fontWeight: 600,
          cursor: total === 0 ? "not-allowed" : "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 2,
        }}
      >
        {allSelected ? "Clear all" : "Select all visible"}
      </button>
      <span style={{ color: "var(--text-faint)" }}>&middot;</span>
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Match score &ge; <b style={{ color: "var(--text)" }}>70%</b>{" "}
        &middot; already-contacted hidden
      </span>
      <span className="bb-spacer" />
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
  sortBy,
  onSortBy,
  totalScored,
  archetypePoolSize,
  archetype,
  isLookalikePending,
  lookalikeData,
  campaignName,
  showAll,
  onToggleShowAll,
  visibleCount,
  customerPartnersCount,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  sortBy: SortBy;
  onSortBy: (s: SortBy) => void;
  totalScored: number;
  archetypePoolSize: number;
  archetype: Archetype;
  isLookalikePending: boolean;
  lookalikeData: LookalikeResult | null;
  campaignName: string;
  showAll: boolean;
  onToggleShowAll: (next: boolean) => void;
  visibleCount: number;
  /** Total customer partners on this campaign — only meaningful when
   *  archetype is "customer". Drives the "Customers on this campaign · 93"
   *  counter in place of the investor "showing N of M scored" label. */
  customerPartnersCount?: number;
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
                  &middot; top {visibleCount} of {scoredLabel} scored
                </span>
              ) : null}
            </>
          ) : archetype === "customer" ? (
            <>
              Customers on this campaign
              <span className="count">
                {" "}&middot;{" "}
                {customerPartnersCount?.toLocaleString("en-GB") ?? "0"}
              </span>
            </>
          ) : (
            <>
              Matched{" "}
              {archetype === "supplier" ? "suppliers" : "investors"}{" "}
              <span className="count">
                &middot; showing {visibleCount} of {scoredLabel} scored
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
          ) : archetype === "customer" ? (
            <>
              Curated list of named customers on this campaign — not a
              semantic-match pool. Use the approval sheet below to
              review, approve and dispatch.
            </>
          ) : (
            <>
              {showAll
                ? `Showing every firm in the ${poolLabel}-strong pool — contacted and uncontacted alike.`
                : "Already-contacted firms hidden."}
            </>
          )}
        </div>
      </div>
      <div
        className="results-sort"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        {/* New-only / Show-all toggle — only meaningful on the hero-scored
            tabs (not Lookalike, which runs its own pool filter). */}
        {!isLookalike ? (
          <div
            className="fm-show-toggle"
            role="tablist"
            aria-label="Show new only or every firm"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!showAll}
              className={!showAll ? "active" : ""}
              onClick={() => onToggleShowAll(false)}
              title="Hide firms already on this campaign"
            >
              New only
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showAll}
              className={showAll ? "active" : ""}
              onClick={() => onToggleShowAll(true)}
              title={`Show every firm in the ${poolLabel}-strong pool`}
            >
              Show all {poolLabel}
            </button>
          </div>
        ) : null}

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

        {/* Secondary sort — applied client-side over the tab-filtered rows.
            Hidden on the Lookalike tab (that mode has its own anchor-based
            ordering that a column sort would defeat). */}
        {tab !== "lookalike" ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--text-dim)",
              marginLeft: 6,
            }}
            title="Re-order the matched investors without changing which rows are scored"
          >
            <span>Order by</span>
            <select
              value={sortBy}
              onChange={(e) => onSortBy(e.target.value as SortBy)}
              style={{
                padding: "5px 8px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                background: "var(--surface)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <option value="match">Match score</option>
              <option value="alphabetical">Alphabetical (A → Z)</option>
              <option value="approval">Approval status</option>
              <option value="recent_contact">Most recently contacted</option>
            </select>
          </label>
        ) : null}
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
  expanded,
  onToggle,
  onExpand,
  onOpenProfile,
}: {
  row: MatchResultRow;
  checked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpenProfile: () => void;
}) {
  const { onClick, onDoubleClick, onKeyDown } = useExpandNavigateHandlers({
    onExpand,
    onOpenProfile,
  });
  return (
    <div
      className={`result-card${checked ? " checked" : ""}${expanded ? " rc-expanded" : ""}`}
      data-card={row.investor_id}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{ cursor: "pointer" }}
    >
      <div
        className="rc-chk-col"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
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
              e.stopPropagation();
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
              <span className="firm">{row.firm_name ?? "—"}</span>
              <TagChips row={row} />
            </div>
            <div className="result-meta">
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

        {/* Scorecard goes first (under the headline+score). Near-miss
            moved BELOW, inside the expand panel so it sits after
            "Why them". Removing it from this slot is deliberate —
            the old order put the weakness above the scorecard which
            buried the positive signal. */}
        <ScoreCard dims={row.dims} />

        <div className="result-tags">
          <ResultTagRow row={row} />
        </div>

        {!expanded && row.why_them ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.5,
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--orange)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 6 }}>Why them</span>
            {row.why_them}
          </div>
        ) : null}

        {expanded ? (
          <ResultCardDrillDown row={row} onOpenProfile={onOpenProfile} />
        ) : null}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Click handlers — expand on single click, navigate on double-click         */
/* ========================================================================= */
/**
 * Per-card handlers that disambiguate a single click (expand the inline
 * drill-down) from a double click (navigate to the full profile page).
 *
 * `onClick` runs on every click; we wait ~220ms before actually calling
 * `onExpand` so that a rapid second click can cancel the timer and let
 * `onDoubleClick` take over. Without the timer, a double-click would
 * visibly flash-open-then-close the drill-down before navigating, which
 * felt janky in manual testing.
 *
 * 220ms is the standard double-click window on macOS (Safari reports
 * ~500ms but most users double-click inside ~250ms).
 */
function useExpandNavigateHandlers({
  onExpand,
  onOpenProfile,
}: {
  onExpand: () => void;
  onOpenProfile: () => void;
}) {
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      // Ignore clicks that originated on a child with its own handler.
      if (e.defaultPrevented) return;
      clearTimer();
      timer.current = window.setTimeout(() => {
        onExpand();
        timer.current = null;
      }, 220);
    },
    [onExpand, clearTimer],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      clearTimer();
      onOpenProfile();
    },
    [onOpenProfile, clearTimer],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onOpenProfile();
      } else if (e.key === " ") {
        e.preventDefault();
        onExpand();
      }
    },
    [onExpand, onOpenProfile],
  );

  return { onClick, onDoubleClick, onKeyDown };
}

/* ========================================================================= */
/* RESULT CARD — expanded drill-down panel                                   */
/* ========================================================================= */

function ResultCardDrillDown({
  row,
  onOpenProfile,
}: {
  row: MatchResultRow;
  onOpenProfile: () => void;
}) {
  const hasWhyThem = Boolean(row.why_them);
  const hasThesis = Boolean(row.thesis_summary);
  const needsEmail = row.verified_email_count === 0;
  return (
    <div
      className="rc-expand"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Order flip (2026-04-22): "Why them" leads, THEN near-miss
          weakness, THEN the meta grid. The old layout put near-miss
          above the scorecard which read as "why NOT them" before
          the user had a chance to see the positive signal. */}
      {hasWhyThem ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Why them</div>
          <p>{row.why_them}</p>
        </div>
      ) : (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Why them</div>
          <p style={{ color: "var(--text-dim)", fontStyle: "italic" }}>
            Haiku synthesis queued · nightly pipeline fills this.
          </p>
        </div>
      )}
      {row.near_miss ? (
        <div className="near-miss" style={{ marginTop: 0 }}>
          <b>{row.near_miss.headline}</b> {row.near_miss.body}
        </div>
      ) : null}
      {hasThesis ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Thesis</div>
          <p>{row.thesis_summary}</p>
        </div>
      ) : null}
      {row.thesis_deep ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Deep thesis</div>
          <p style={{ whiteSpace: "pre-line" }}>{row.thesis_deep}</p>
        </div>
      ) : null}
      {row.ideal_company_profile ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Ideal company profile</div>
          <p>{row.ideal_company_profile}</p>
        </div>
      ) : null}
      {row.portfolio_fit && row.portfolio_fit.length > 0 ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">
            Portfolio fit · top {row.portfolio_fit.length}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {row.portfolio_fit.map((p) => (
              <li
                key={p.slug}
                style={{
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-soft)",
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {p.sector ? (
                    <span
                      style={{
                        color: "var(--text-dim)",
                        fontSize: 11,
                      }}
                    >
                      · {p.sector}
                    </span>
                  ) : null}
                </div>
                {p.what_they_do ? (
                  <div
                    style={{
                      color: "var(--text-dim)",
                      marginTop: 2,
                    }}
                  >
                    {p.what_they_do}
                  </div>
                ) : (
                  <div
                    style={{
                      color: "var(--text-faint)",
                      marginTop: 2,
                      fontStyle: "italic",
                    }}
                  >
                    No dossier prose on file yet — populates once the
                    portfolio-company synthesiser runs.
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rc-expand-grid">
        <MetaCell
          label="Stage"
          value={row.stage_focus ?? <Faint>not on file</Faint>}
        />
        <MetaCell
          label="Geo"
          value={row.geo_focus ?? <Faint>not on file</Faint>}
        />
        <MetaCell
          label="Cheque"
          value={
            row.cheque_min_raw || row.cheque_max_raw ? (
              <>
                {row.cheque_min_raw
                  ? formatRawAmount(row.cheque_min_raw)
                  : "—"}
                {" – "}
                {row.cheque_max_raw
                  ? formatRawAmount(row.cheque_max_raw)
                  : "—"}
              </>
            ) : (
              <Faint>not on file</Faint>
            )
          }
        />
        <MetaCell
          label="Primary partner"
          value={
            row.primary_partner?.name ? (
              <>
                {row.primary_partner.name}
                {row.primary_partner.title ? (
                  <span style={{ color: "var(--text-dim)" }}>
                    {" · "}
                    {row.primary_partner.title}
                  </span>
                ) : null}
              </>
            ) : (
              <Faint>no primary on file</Faint>
            )
          }
        />
      </div>
      <div className="rc-expand-actions">
        <button
          type="button"
          className="batch-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile();
          }}
        >
          Open full profile →
        </button>
        {needsEmail ? (
          <button
            type="button"
            className="batch-btn rc-expand-resolve"
            data-resolve-email={row.investor_id}
            onClick={(e) => {
              e.stopPropagation();
              // Dispatched to the email-hunt modal via a bubbling custom
              // event — the modal is mounted higher in the tree and
              // listens for it. Keeps the drill-down decoupled from
              // modal state.
              window.dispatchEvent(
                new CustomEvent("fc:resolve-email", {
                  detail: { investorId: row.investor_id },
                }),
              );
            }}
          >
            Resolve email →
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MetaCell({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rc-meta-cell">
      <div className="rc-meta-label">{label}</div>
      <div className="rc-meta-value">{value}</div>
    </div>
  );
}

function Faint({ children }: { children: React.ReactNode }) {
  return <i style={{ color: "var(--text-faint)" }}>{children}</i>;
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
  // Mirror the sendable bucket in `lib/queries/tracker.ts` (corresponded,
  // hunter_verified, neverbounce_valid, neverbounce_catchall). Any tier
  // outside that set, with zero verified emails on the firm overall,
  // earns the red email-gate chip.
  const sendableTiers = new Set<string>([
    "corresponded",
    "hunter_verified",
    "neverbounce_valid",
    "neverbounce_catchall",
  ]);
  const primaryTier = row.primary_partner?.email_tier ?? "";
  if (!sendableTiers.has(primaryTier) && row.verified_email_count === 0) {
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
          {row.primary_partner.id != null ? (
            <Link
              href={`/partner/${row.primary_partner.id}`}
              className="tag-chip-link"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open partner profile for ${row.primary_partner.name}`}
            >
              {row.primary_partner.name}
            </Link>
          ) : (
            row.primary_partner.name
          )}
          {row.primary_partner.title ? ` · ${row.primary_partner.title}` : ""}
        </span>
      ) : null}
      {row.verified_email_count === 0 ? (
        <span
          className="tag-chip tag-warn"
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("fc:resolve-email", {
                detail: { investorId: row.investor_id },
              }),
            );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("fc:resolve-email", {
                  detail: { investorId: row.investor_id },
                }),
              );
            }
          }}
        >
          <span>⚠</span>Resolve email →
        </span>
      ) : null}
    </>
  );
}

/* ========================================================================= */
/* SCORECARD — V4 lines 1014-1021                                             */
/* ========================================================================= */

/**
 * Scorecard dim labels as shown to the user. The 6th dim's internal key
 * is still `data` (migrations + match-score-types.ts untouched), but the
 * user-facing label flipped to "Confidence" on 2026-04-22 because "Data"
 * reads as "how much data do you have?" not "how confident are we?".
 */
const DIM_ORDER: Array<{ key: keyof ScoreDims; label: string }> = [
  { key: "thesis", label: "Thesis" },
  { key: "stage", label: "Stage" },
  { key: "geo", label: "Geo" },
  { key: "cheque", label: "Cheque" },
  { key: "activity", label: "Activity" },
  { key: "data", label: "Confidence" },
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

function ArchetypePoolEmpty({
  archetype,
  campaignId,
}: {
  archetype: Archetype;
  campaignId: string;
}) {
  const label = archetype === "customer" ? "Customer" : "Supplier";
  const labelLower = label.toLowerCase();

  // Customer outreach doesn't flow through semantic match-scoring —
  // the customer list is a curated set (e.g. the 93 Fischer Farms
  // prospects from the V4 briefing), not a 50K-row pool. Point the
  // founder at /approval where the actual customer partners live.
  if (archetype === "customer") {
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
          Customer outreach doesn’t use semantic matching.
        </div>
        <p
          style={{
            margin: "6px auto 8px auto",
            maxWidth: 460,
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
          Your customer list is a curated set (named retailers, growers,
          DIY chains, DTC brands) — not a pool to score. Your Wave 1 / 2 / 3
          / Niche prospects live on the approval sheet below.
        </p>
        <Link
          href={`/approval?c=${campaignId}`}
          style={{
            display: "inline-block",
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            background: "var(--surface)",
            border: "1px solid var(--accent)",
            borderRadius: 999,
            textDecoration: "none",
          }}
        >
          Go to approval sheet →
        </Link>
      </div>
    );
  }

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
        {label} pool lands in a later section.
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
        for the next Forge Capital pipeline release to populate the{" "}
        {labelLower} mirror.
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
  expandedId,
  onExpand,
  onOpenProfile,
}: {
  data: LookalikeResult | null;
  isPending: boolean;
  campaignName: string;
  selected: Set<number>;
  onToggle: (investorId: number) => void;
  expandedId: number | null;
  onExpand: (investorId: number) => void;
  onOpenProfile: (investorId: number) => void;
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
              expanded={expandedId === row.investor_id}
              onToggle={() => onToggle(row.investor_id)}
              onExpand={() => onExpand(row.investor_id)}
              onOpenProfile={() => onOpenProfile(row.investor_id)}
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
  expanded,
  onToggle,
  onExpand,
  onOpenProfile,
}: {
  row: LookalikeRow;
  checked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onOpenProfile: () => void;
}) {
  const { onClick, onDoubleClick, onKeyDown } = useExpandNavigateHandlers({
    onExpand,
    onOpenProfile,
  });
  return (
    <div
      className={`result-card${checked ? " checked" : ""}${expanded ? " rc-expanded" : ""}`}
      data-card={row.investor_id}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{ cursor: "pointer" }}
    >
      <div
        className="rc-chk-col"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
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
              e.stopPropagation();
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
        {expanded ? (
          <LookalikeDrillDown row={row} onOpenProfile={onOpenProfile} />
        ) : null}
      </div>
    </div>
  );
}

function LookalikeDrillDown({
  row,
  onOpenProfile,
}: {
  row: LookalikeRow;
  onOpenProfile: () => void;
}) {
  return (
    <div
      className="rc-expand"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {row.matched_anchors.length > 0 ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Looks like</div>
          <p>
            {row.matched_anchors.join(", ")} — the respondents this
            investor most overlaps with.
          </p>
        </div>
      ) : null}
      {row.thesis_summary ? (
        <div className="rc-expand-block">
          <div className="rc-expand-label">Thesis</div>
          <p>{row.thesis_summary}</p>
        </div>
      ) : null}
      <div className="rc-expand-grid">
        <MetaCell
          label="Stage"
          value={row.stage_focus ?? <Faint>not on file</Faint>}
        />
        <MetaCell
          label="Geo"
          value={row.geo_focus ?? <Faint>not on file</Faint>}
        />
        <MetaCell
          label="Sector"
          value={row.sector_focus ?? <Faint>not on file</Faint>}
        />
        <MetaCell
          label="HQ"
          value={row.hq_location ?? <Faint>not on file</Faint>}
        />
      </div>
      <div className="rc-expand-actions">
        <button
          type="button"
          className="batch-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile();
          }}
        >
          Open full profile →
        </button>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* PITCH INPUT — textarea + drag-and-drop pitch extraction                   */
/* ========================================================================= */

function PitchInput({
  heroText,
  setHeroText,
  onKeyDown,
  onFindMatches,
  isPending,
  textareaRef,
  onSynthesised,
}: {
  heroText: string;
  setHeroText: (s: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFindMatches: () => void;
  isPending: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Called when the upload endpoint returns a Haiku-synthesised
   *  profile. Parent applies the structured fields to the filter
   *  bar. Matches the DumpInfoBox `onProfile` contract. */
  onSynthesised?: (profile: {
    stage: string | null;
    geography: string | null;
    raise_amount: string | null;
    sectors: string[];
    description: string | null;
  }) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<
    | {
        kind: "ok";
        filename: string;
        chars: number;
        synthesised: boolean;
        rawText: string | null;
      }
    | { kind: "err"; message: string }
    | null
  >(null);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setExtracting(true);
    setExtractMsg(null);
    setShowRaw(false);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract-pitch", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!json.ok) {
        setExtractMsg({ kind: "err", message: json.error ?? "Extraction failed" });
        return;
      }
      // The server returns `text` = summary if Haiku synthesised it, else
      // raw text. Both paths populate the hero textarea. When synthesis
      // fired, also bubble the structured profile up to the filter bar.
      setHeroText(json.text);
      if (onSynthesised && json.profile) {
        onSynthesised(json.profile);
      }
      setExtractMsg({
        kind: "ok",
        filename: json.filename,
        chars: json.originalChars,
        synthesised: Boolean(json.summary),
        rawText: typeof json.raw_text === "string" ? json.raw_text : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setExtractMsg({ kind: "err", message });
    } finally {
      setExtracting(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset so the same file can be re-selected later
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div
      className="hero-input-wrap"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      <textarea
        ref={textareaRef}
        className="hero-input"
        value={heroText}
        onChange={(e) => setHeroText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        // Drag-and-drop: the wrapper's onDrop only fires if the browser
        // doesn't intercept the drop on the textarea's native handler
        // first. Chrome in particular tries to read dropped files as
        // text inside a textarea. Defeat that by preventDefault on the
        // textarea's own dragover + drop AND forwarding the file to the
        // shared handleFile. Tristan flagged 2026-04-23 that dropping
        // a PPTX onto the box did nothing.
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        // V4's .hero-input has padding: 16px 120px 16px 20px — the 120px
        // right-pad is reserved for the Find matches button sitting in
        // the textarea corner. We've moved Find matches OUT to the
        // action row below, so give the right-pad back to the content
        // and let the full textarea be a clean drop target.
        style={{ paddingRight: 20 }}
      />

      {/* Drag overlay — only shown while a file is being dragged over. */}
      {dragOver ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(79, 70, 229, 0.08)",
            border: "2px dashed var(--accent)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            fontSize: 14,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          Drop your deck / PDF / DOCX / PPTX to extract the pitch text
        </div>
      ) : null}

      {/* Extracting spinner overlay. */}
      {extracting ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.85)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
            fontSize: 13,
          }}
        >
          Reading the file…
        </div>
      ) : null}

      {/* Action row under the textarea — Upload deck on the left,
          Find matches on the right. Nothing overlaps the textarea drop
          target. The textarea itself still accepts drops thanks to
          onDragOver / onDrop on .hero-input-wrap. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Upload a pitch deck, business plan, PDF, DOCX, or PPTX — or just drag it onto the box above. We'll extract the text for matching."
          disabled={extracting || isPending}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            borderRadius: 8,
            cursor: extracting || isPending ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          📎 Upload deck (PDF / PPTX / DOCX)
        </button>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            flex: "0 1 auto",
          }}
        >
          or drag a file onto the box above
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.pptx,.docx,.xlsx,.odt,.odp,.ods,.txt,.md"
          style={{ display: "none" }}
          onChange={onFileChange}
        />

        {/* Spacer pushes Find matches to the far right. */}
        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onFindMatches}
          disabled={isPending || extracting}
          // Inline styles deliberately — .hero-btn has `position: absolute`
          // baked into v4-mockup.css for its in-textarea placement. Re-use
          // the V4 accent colour + typography here without the positioning.
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            fontSize: 13,
            fontWeight: 600,
            cursor: isPending || extracting ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: isPending || extracting ? 0.7 : 1,
          }}
        >
          {isPending ? "Matching…" : "Find matches"}{" "}
          <span
            style={{
              fontSize: 10,
              opacity: 0.7,
              padding: "1px 5px",
              background: "rgba(255,255,255,0.18)",
              borderRadius: 3,
            }}
          >
            ⌘↵
          </span>
        </button>
      </div>

      {/* Status line below the textarea. When Haiku synthesised the
          deck, tell the user we're showing the summary + the filter
          bar has been pre-filled. Offer a toggle to peek at the raw
          extracted text in case the summary missed something. */}
      {extractMsg ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color:
              extractMsg.kind === "ok"
                ? "var(--green)"
                : "var(--red)",
          }}
        >
          {extractMsg.kind === "ok" ? (
            <>
              {extractMsg.synthesised ? (
                <>
                  ✓ Synthesised <b>{extractMsg.filename}</b> ({extractMsg.chars.toLocaleString("en-GB")} chars →{" "}
                  {heroText.length.toLocaleString("en-GB")} char pitch · filter bar pre-filled).
                  Edit the text above before hitting Find matches.
                  {extractMsg.rawText ? (
                    <>
                      {" · "}
                      <a
                        style={{ cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => setShowRaw((v) => !v)}
                      >
                        {showRaw ? "hide original" : "show original deck text"}
                      </a>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  ✓ Extracted {extractMsg.chars.toLocaleString("en-GB")} chars
                  from <b>{extractMsg.filename}</b>. Edit the text above before
                  hitting Find matches if you want to focus the pitch.
                </>
              )}
            </>
          ) : (
            <>⚠ {extractMsg.message}</>
          )}
        </div>
      ) : null}
      {extractMsg?.kind === "ok" && showRaw && extractMsg.rawText ? (
        <div
          style={{
            marginTop: 6,
            padding: "10px 12px",
            fontSize: 11,
            color: "var(--text-dim)",
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            maxHeight: 260,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {extractMsg.rawText}
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================= */
/* FILTER BAR — client-side post-score filtering                              */
/* ========================================================================= */

/**
 * One-line filter bar with four dropdowns: Stage, Geography, Type,
 * Cheque Size. Sits between the hero panel and the batch bar. Filters
 * apply client-side over the already-scored rows; the server-side
 * pruning equivalent lands in a future step (will let the scorer
 * exclude candidates up front rather than rank-then-hide).
 */
function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const reset = () => onChange(DEFAULT_FILTERS);
  const active =
    filters.stage !== "any" ||
    filters.geo !== "any" ||
    filters.type !== "any" ||
    filters.cheque !== "any";
  return (
    <div className="fm-filter-bar" role="region" aria-label="Filter matches">
      <span className="fm-filter-label">Filter</span>

      <label className="fm-filter-field">
        <span>Stage</span>
        <select
          value={filters.stage}
          onChange={(e) => onChange({ ...filters, stage: e.target.value as StageFilter })}
        >
          <option value="any">Any</option>
          <option value="pre-seed">Pre-seed</option>
          <option value="seed">Seed</option>
          <option value="series-a">Series A</option>
          <option value="series-b">Series B</option>
          <option value="growth">Growth</option>
        </select>
      </label>

      <label className="fm-filter-field">
        <span>Geography</span>
        <select
          value={filters.geo}
          onChange={(e) => onChange({ ...filters, geo: e.target.value as GeoFilter })}
        >
          <option value="any">Any</option>
          <option value="uk">United Kingdom</option>
          <option value="eu">European Union</option>
          <option value="us">United States</option>
          <option value="global">Global</option>
        </select>
      </label>

      <label className="fm-filter-field">
        <span>Type</span>
        <select
          value={filters.type}
          onChange={(e) => onChange({ ...filters, type: e.target.value as TypeFilter })}
        >
          <option value="any">Any</option>
          <option value="vc">Venture capital</option>
          <option value="accelerator">Accelerator</option>
          <option value="grant">Grant</option>
          <option value="corporate">Corporate</option>
          <option value="angel">Angel</option>
        </select>
      </label>

      <label className="fm-filter-field">
        <span>Cheque size</span>
        <select
          value={filters.cheque}
          onChange={(e) => onChange({ ...filters, cheque: e.target.value as ChequeFilter })}
        >
          <option value="any">Any</option>
          <option value="lt500k">Under $500K</option>
          <option value="500k-2m">$500K – $2M</option>
          <option value="2m-10m">$2M – $10M</option>
          <option value="10m-plus">$10M+</option>
        </select>
      </label>

      {active ? (
        <button
          type="button"
          onClick={reset}
          className="fm-filter-clear"
          title="Clear all filters"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/* ========================================================================= */
/* DUMP INFO BOX — drag-and-drop profile extraction via Haiku                 */
/* ========================================================================= */

/**
 * Floating drop zone above the hero. Accepts a file OR a block of
 * pasted text, ships it to `/api/extract-pitch?mode=profile` (which
 * calls Haiku), and pre-fills both the hero textarea and the filter
 * row from the structured response.
 *
 * Graceful degradation: if `ANTHROPIC_API_KEY` isn't configured the
 * route returns `{ ok: false, reason: "no_haiku_key" }` and we drop
 * the raw text straight into the textarea instead — the founder can
 * still match, they just don't get the auto-filled filter row.
 */
function DumpInfoBox({
  onProfile,
  setHeroText,
}: {
  onProfile: (p: {
    stage: string | null;
    geography: string | null;
    raise_amount: string | null;
    sectors: string[];
    description: string | null;
  }) => void;
  setHeroText: (s: string) => void;
}) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    | { kind: "ok"; summary: string }
    | { kind: "info"; summary: string }
    | { kind: "err"; summary: string }
    | null
  >(null);

  const extractFromText = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/extract-pitch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "profile", text: trimmed }),
        });
        const json = (await res.json()) as
          | {
              ok: true;
              profile: {
                stage: string | null;
                geography: string | null;
                raise_amount: string | null;
                sectors: string[];
                description: string | null;
              };
            }
          | { ok: false; reason?: string; message?: string; error?: string };
        if (json.ok) {
          onProfile(json.profile);
          const filled: string[] = [];
          if (json.profile.stage) filled.push(`stage = ${json.profile.stage}`);
          if (json.profile.geography)
            filled.push(`geography = ${json.profile.geography}`);
          if (json.profile.raise_amount)
            filled.push(`raise = ${json.profile.raise_amount}`);
          if (json.profile.sectors.length > 0)
            filled.push(`sectors = ${json.profile.sectors.join(", ")}`);
          setMsg({
            kind: "ok",
            summary:
              filled.length > 0
                ? `Haiku extracted: ${filled.join(" · ")}. Textarea + filters pre-filled.`
                : "Description extracted into the textarea. Haiku couldn't infer structured fields — refine manually.",
          });
          setText("");
        } else {
          if (json.reason === "no_haiku_key") {
            // Graceful fallback — no Haiku key, dump raw text into textarea.
            setHeroText(trimmed.slice(0, 8000));
            setMsg({
              kind: "info",
              summary:
                json.message ??
                "Profile extraction unavailable. Pasted the text into the textarea instead.",
            });
            setText("");
          } else {
            setMsg({
              kind: "err",
              summary: json.error ?? json.message ?? "Extraction failed.",
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed";
        setMsg({ kind: "err", summary: message });
      } finally {
        setBusy(false);
      }
    },
    [onProfile, setHeroText],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.getData("text/plain");
    if (dropped && dropped.trim().length > 0) {
      void extractFromText(dropped);
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Read the file as text and ship to profile mode. Non-text files
      // (PDF etc.) should go through the textarea upload — surface that.
      const isText =
        file.type.startsWith("text/") ||
        /\.(txt|md|eml|rtf|log)$/i.test(file.name);
      if (!isText) {
        setMsg({
          kind: "err",
          summary: `Drop a text snippet here. For decks / PDFs, use the "Upload deck" button in the hero below.`,
        });
        return;
      }
      file.text().then((body) => void extractFromText(body));
    }
  }

  return (
    <div
      className={`fm-dump-box${dragOver ? " drag-over" : ""}${busy ? " busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      aria-label="Dump pitch info — drag text, an email, or a bio here"
    >
      <div className="fm-dump-head">
        <span className="fm-dump-title">Dump pitch info</span>
        <span className="fm-dump-sub">
          Drop an email, bio, or paste a snippet — Haiku fills the textarea
          and the filter row in one step.
        </span>
      </div>
      <textarea
        className="fm-dump-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste anything a reader would need to route you: a forwarded email, a founder bio, a deck blurb, a one-line elevator pitch…"
        spellCheck={false}
        rows={3}
      />
      <div className="fm-dump-actions">
        <button
          type="button"
          onClick={() => void extractFromText(text)}
          disabled={busy || text.trim().length === 0}
          className="fm-dump-btn"
        >
          {busy ? "Extracting…" : "Extract with Haiku"}
        </button>
        {msg ? (
          <span className={`fm-dump-msg ${msg.kind}`} role="status">
            {msg.summary}
          </span>
        ) : (
          <span className="fm-dump-hint">
            Or drag a text file / snippet onto this box.
          </span>
        )}
      </div>
    </div>
  );
}
