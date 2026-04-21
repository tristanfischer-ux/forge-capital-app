"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Filters bar above the match grid. Pure URL-state — we push filter
 * values back into the query string and let the server component
 * refetch. No local state leaks between pages, and a bookmark captures
 * exactly the view Tristan is looking at.
 *
 * The four text inputs are all ilike filters on `investors_mirror`
 * columns; the sort + page-size selects and the "include existing"
 * toggle shape the query in the same round-trip. Round-2 feedback:
 * dedupe ON by default, toggle to show all.
 */

export interface MatchFiltersProps {
  campaignId: string;
  initialSector: string;
  initialStage: string;
  initialGeo: string;
  initialThesis: string;
  initialSort: string;
  initialPageSize: number;
  initialIncludeExisting: boolean;
}

const SORT_OPTIONS = [
  { value: "firm_name:asc", label: "Firm name (A–Z)" },
  { value: "firm_name:desc", label: "Firm name (Z–A)" },
  { value: "last_synced:desc", label: "Newest-synced first" },
  { value: "last_synced:asc", label: "Oldest-synced first" },
] as const;

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function MatchFilters({
  campaignId,
  initialSector,
  initialStage,
  initialGeo,
  initialThesis,
  initialSort,
  initialPageSize,
  initialIncludeExisting,
}: MatchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [sector, setSector] = useState(initialSector);
  const [stage, setStage] = useState(initialStage);
  const [geo, setGeo] = useState(initialGeo);
  const [thesis, setThesis] = useState(initialThesis);
  const [sort, setSort] = useState(initialSort);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [includeExisting, setIncludeExisting] = useState(initialIncludeExisting);

  function pushQuery(next: URLSearchParams) {
    // Preserve `?c=<campaign>` — everything else is filter state.
    next.set("c", campaignId);
    // Any filter change resets pagination to page 0 — otherwise the
    // user ends up on page 7 of a result set that only has 1 page.
    next.delete("p");
    startTransition(() => {
      router.push(`/match?${next.toString()}`);
    });
  }

  function onApply(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    setOrDelete(next, "sector", sector);
    setOrDelete(next, "stage", stage);
    setOrDelete(next, "geo", geo);
    setOrDelete(next, "thesis", thesis);
    next.set("sort", sort);
    next.set("ps", String(pageSize));
    if (includeExisting) next.set("all", "1");
    else next.delete("all");
    pushQuery(next);
  }

  function onReset() {
    setSector("");
    setStage("");
    setGeo("");
    setThesis("");
    setSort("firm_name:asc");
    setPageSize(50);
    setIncludeExisting(false);
    const next = new URLSearchParams();
    pushQuery(next);
  }

  return (
    <form
      onSubmit={onApply}
      className="rounded-[10px] border border-border bg-surface p-4 shadow-[var(--shadow)]"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <TextField
          label="Sector"
          value={sector}
          onChange={setSector}
          placeholder="e.g. climate, industrial"
        />
        <TextField
          label="Stage"
          value={stage}
          onChange={setStage}
          placeholder="e.g. Series A"
        />
        <TextField
          label="Geography"
          value={geo}
          onChange={setGeo}
          placeholder="e.g. UK, EU"
        />
        <TextField
          label="Thesis keyword"
          value={thesis}
          onChange={setThesis}
          placeholder="e.g. hardware, deep tech"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <SelectField
          label="Sort by"
          value={sort}
          onChange={setSort}
          options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <SelectField
          label="Page size"
          value={String(pageSize)}
          onChange={(v) => setPageSize(Number(v))}
          options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <label className="flex items-center gap-2 text-[12px] text-text">
          <input
            type="checkbox"
            checked={includeExisting}
            onChange={(e) => setIncludeExisting(e.target.checked)}
            className="h-3.5 w-3.5 rounded-sm border-border accent-[color:var(--accent)]"
          />
          Also show investors already in this campaign
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text-dim hover:border-accent hover:text-accent"
            disabled={isPending}
          >
            Reset
          </button>
          <button
            type="submit"
            className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-dark disabled:opacity-60"
            disabled={isPending}
          >
            {isPending ? "Applying…" : "Apply filters"}
          </button>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-text-faint">
        Filters are case-insensitive and match anywhere in the column
        (ilike). Only firms marked <code>actively_deploying = true</code>
        are ever shown.
      </p>
    </form>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  const v = value.trim();
  if (v.length === 0) params.delete(key);
  else params.set(key, v);
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-dim">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-dim">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
