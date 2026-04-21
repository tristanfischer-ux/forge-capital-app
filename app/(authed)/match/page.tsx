import { redirect } from "next/navigation";
import {
  listActiveCampaigns,
  resolveCurrentCampaignId,
} from "@/lib/queries/campaigns";
import {
  getMatchRows,
  type MatchSortKey,
  type MatchSortDir,
} from "@/lib/queries/match";
import { MatchFilters } from "./MatchFilters";
import { MatchGrid } from "./MatchGrid";

/**
 * Match / shortlist page — V1 discover-and-shortlist surface.
 * Ports Phase2-Mockup-V4.html §"Find a match" (lines 912–1146) with the
 * two round-2 corrections:
 *   1. Dedupe firms already in this campaign by default.
 *   2. Single "Shortlist top N" control (no per-row checkboxes).
 *
 * Server component — fetches filters + rows on the server, passes to
 * the client MatchGrid for the shortlist confirmation flow.
 *
 * Force dynamic: the URL carries filter state (?sector, ?stage, …) and
 * we do not want any of it served from the per-segment cache.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  c?: string;
  sector?: string;
  stage?: string;
  geo?: string;
  thesis?: string;
  sort?: string;
  ps?: string;
  p?: string;
  all?: string;
}>;

function parseSort(raw: string | undefined): { key: MatchSortKey; dir: MatchSortDir } {
  // Sort serialises as "key:dir". Fall back to firm_name:asc on any
  // malformed input — we never error on a bad query string.
  const [key, dir] = (raw ?? "firm_name:asc").split(":");
  const safeKey: MatchSortKey =
    key === "last_synced" ? "last_synced" : "firm_name";
  const safeDir: MatchSortDir = dir === "desc" ? "desc" : "asc";
  return { key: safeKey, dir: safeDir };
}

function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  if (n === 25 || n === 50 || n === 100) return n;
  return 50;
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export default async function MatchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const campaigns = await listActiveCampaigns();
  const campaignId = resolveCurrentCampaignId(campaigns, params.c);

  // If the user lands here without any campaign selected at all (i.e.
  // RLS returned nothing or there are genuinely no campaigns), they
  // have to pick one from the tracker first — that's where the switcher
  // chips actually drive selection. Redirecting honours the brief.
  if (!campaignId) {
    redirect("/tracker");
  }

  // The layout's switcher always writes `?c=` when the user clicks a
  // chip, so if we landed here without `?c=` but a default campaign
  // exists, bounce to the canonical URL so the switcher highlights and
  // subsequent filter changes compose cleanly.
  if (!params.c) {
    redirect(`/match?c=${campaignId}`);
  }

  const activeCampaign = campaigns.find((cmp) => cmp.id === campaignId);
  const { key: sortKey, dir: sortDir } = parseSort(params.sort);
  const pageSize = parsePageSize(params.ps);
  const page = parsePage(params.p);
  const includeExisting = params.all === "1";

  const filters = {
    sector: params.sector ?? null,
    stage: params.stage ?? null,
    geo: params.geo ?? null,
    thesis: params.thesis ?? null,
  };

  const { rows, total } = await getMatchRows({
    campaignId,
    filters,
    includeExisting,
    sortKey,
    sortDir,
    pageSize,
    page,
  });

  return (
    <div className="space-y-5">
      {/* Section head — mirrors the tracker's head strip for visual
          continuity. The campaign switcher lives in the authed layout
          above us; we echo the campaign name here for context. */}
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-text">
            Shortlist
            {activeCampaign ? (
              <>
                {" "}
                <span className="text-text-dim"> — {activeCampaign.name}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-0.5 text-[12px] text-text-dim">
            Discover investors from the nightly mirror and shortlist
            them into this campaign. Firms already on the campaign are
            hidden by default; use the toggle to show them.
          </p>
        </div>
      </div>

      <MatchFilters
        campaignId={campaignId}
        initialSector={params.sector ?? ""}
        initialStage={params.stage ?? ""}
        initialGeo={params.geo ?? ""}
        initialThesis={params.thesis ?? ""}
        initialSort={`${sortKey}:${sortDir}`}
        initialPageSize={pageSize}
        initialIncludeExisting={includeExisting}
      />

      {total === 0 && !hasAnyFilter(filters) && !includeExisting ? (
        <NoMirrorDataState />
      ) : (
        <MatchGrid
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          campaignId={campaignId}
          campaignName={activeCampaign?.name ?? ""}
          filters={filters}
          sortKey={sortKey}
          sortDir={sortDir}
          includeExisting={includeExisting}
        />
      )}
    </div>
  );
}

function hasAnyFilter(filters: {
  sector: string | null;
  stage: string | null;
  geo: string | null;
  thesis: string | null;
}): boolean {
  return [filters.sector, filters.stage, filters.geo, filters.thesis].some(
    (v) => v !== null && v.trim().length > 0,
  );
}

/**
 * Shown when the mirror appears empty AND no filters are active —
 * indicates the nightly sync has not yet populated investors_mirror.
 * Distinct from "no matches for your filters" which renders inside the
 * grid itself.
 */
function NoMirrorDataState() {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-light text-accent">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h2 className="mb-1.5 text-[14px] font-semibold text-text">
        No investor data loaded yet
      </h2>
      <p className="mx-auto max-w-md text-[12px] leading-relaxed text-text-dim">
        The nightly sync runs at 06:00 BST and populates{" "}
        <code className="rounded-sm bg-surface-alt px-1 py-0.5 font-mono text-[11px]">
          investors_mirror
        </code>{" "}
        from the local Forge Capital pipeline.
      </p>
    </div>
  );
}
