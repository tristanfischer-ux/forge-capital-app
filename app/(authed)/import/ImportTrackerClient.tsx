"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Client half of /import. Supports two modes:
 *
 * "single" — import into one campaign (the active campaign passed as a prop).
 *   Three UI states: empty → previewed → applied.
 *
 * "all" — detect all campaign column groups from the xlsx and import into
 *   every matched campaign in one pass. Three UI states: empty → previewed
 *   (per-campaign summary cards) → applied (per-campaign result cards).
 *
 * Mode is toggled via a tab strip above the drop zone.
 */

interface ParsedTrackerRow {
  row_number: number;
  sheet_name: string;
  firm_name: string | null;
  contact_name: string | null;
  email: string | null;
  status_code: string | null;
  status_label: string | null;
  commentary: string | null;
  last_contact_at: string | null;
  matched_investor_id: number | null;
  matched_investor_firm: string | null;
  match_reason: "exact" | "contains" | "token_subset" | "ambiguous" | "none";
  existing_campaign_partner_id: string | null;
  planned_action: "insert" | "update" | "skip_no_match" | "skip_ambiguous";
  warnings: string[];
}

interface ParsedTracker {
  campaign_id: string;
  campaign_name: string;
  filename: string;
  sheet_names: string[];
  rows: ParsedTrackerRow[];
  matched_count: number;
  unmatched_count: number;
  ambiguous_count: number;
  new_campaign_partner_count: number;
  update_count: number;
  missing_from_sheet: number;
}

interface AllCampaignEntry {
  group_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  parsed: ParsedTracker | null;
  skip_reason: string | null;
}

interface AllCampaignsParsed {
  filename: string;
  campaigns: AllCampaignEntry[];
  skipped_info_groups: string[];
}

interface ApplyResult {
  inserted: number;
  updated: number;
  duplicates: number;
  skipped: number;
  errors: Array<{ firm: string; reason: string }>;
}

interface AllCampaignApplyResult {
  campaign_id: string;
  campaign_name: string;
  result: ApplyResult;
}

export function ImportTrackerClient({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "all">("single");

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", width: "fit-content" }}>
        <button
          type="button"
          onClick={() => setMode("single")}
          style={{
            padding: "7px 18px",
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            background: mode === "single" ? "var(--accent)" : "var(--surface)",
            color: mode === "single" ? "white" : "var(--text-dim)",
            cursor: "pointer",
            transition: "background 120ms, color 120ms",
          }}
        >
          Import single campaign
        </button>
        <button
          type="button"
          onClick={() => setMode("all")}
          style={{
            padding: "7px 18px",
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            borderLeft: "1px solid var(--border)",
            background: mode === "all" ? "var(--accent)" : "var(--surface)",
            color: mode === "all" ? "white" : "var(--text-dim)",
            cursor: "pointer",
            transition: "background 120ms, color 120ms",
          }}
        >
          Import all campaigns
        </button>
      </div>

      {mode === "single" ? (
        <SingleCampaignImport
          campaignId={campaignId}
          campaignName={campaignName}
          router={router}
        />
      ) : (
        <AllCampaignsImport router={router} />
      )}
    </div>
  );
}

// ── Single-campaign import ────────────────────────────────────────────

function SingleCampaignImport({
  campaignId,
  campaignName,
  router,
}: {
  campaignId: string;
  campaignName: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedTracker | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, startParseTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setParsed(null);
    setSelected(new Set());
    setApplied(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    startParseTransition(async () => {
      try {
        const form = new FormData();
        form.append("file", f);
        form.append("campaign_id", campaignId);
        const res = await fetch("/api/ingest-tracker/parse", {
          method: "POST",
          body: form,
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "Parse failed");
          return;
        }
        const p = json.parsed as ParsedTracker;
        setParsed(p);
        const defaultSelected = new Set<string>();
        for (const row of p.rows) {
          if (
            (row.planned_action === "insert" || row.planned_action === "update") &&
            row.warnings.length === 0
          ) {
            defaultSelected.add(`${row.sheet_name}:${row.row_number}`);
          }
        }
        setSelected(defaultSelected);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Parse failed");
      }
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    if (!parsed) return;
    setSelected(
      new Set(
        parsed.rows
          .filter((r) => r.planned_action === "insert" || r.planned_action === "update")
          .map((r) => `${r.sheet_name}:${r.row_number}`),
      ),
    );
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function apply() {
    if (!file || !parsed) return;
    setError(null);
    startApplyTransition(async () => {
      try {
        const rows = parsed.rows
          .filter((r) => selected.has(`${r.sheet_name}:${r.row_number}`))
          .map((r) => ({ sheet_name: r.sheet_name, row_number: r.row_number }));
        const form = new FormData();
        form.append("file", file);
        form.append("campaign_id", campaignId);
        form.append("apply", JSON.stringify(rows));
        const res = await fetch("/api/ingest-tracker/apply", {
          method: "POST",
          body: form,
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "Apply failed");
          return;
        }
        setApplied(json.result as ApplyResult);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Apply failed");
      }
    });
  }

  if (applied) {
    return (
      <section style={cardStyle}>
        <h2 style={cardTitleStyle}>✓ Ingest applied to {campaignName}</h2>
        <ApplyResultList result={applied} />
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button type="button" onClick={reset} style={buttonStyle("primary")}>
            Import another file
          </button>
          <a href="/tracker" style={{ ...buttonStyle("secondary"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            View tracker →
          </a>
        </div>
      </section>
    );
  }

  if (parsed) {
    return (
      <>
        <PreviewHeader parsed={parsed} selectedCount={selected.size} />
        <PreviewTable parsed={parsed} selected={selected} toggleRow={toggleRow} />
        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={selectAll} style={buttonStyle("secondary")}>
            Select all insertable / updatable
          </button>
          <button type="button" onClick={clearAll} style={buttonStyle("secondary")}>
            Clear
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={reset} style={buttonStyle("secondary")}>
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={isApplying || selected.size === 0}
            style={buttonStyle("primary")}
          >
            {isApplying ? "Applying…" : `Apply ${selected.size} row${selected.size === 1 ? "" : "s"} →`}
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </>
    );
  }

  return (
    <>
      <DropZone
        dragOver={dragOver}
        isParsing={isParsing}
        fileInputRef={fileInputRef}
        onDrop={onDrop}
        onDragOver={() => { if (!dragOver) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onFileChange={onFileChange}
        hint={`Will import into: ${campaignName}`}
      />
      {error ? <ErrorBanner message={error} /> : null}
    </>
  );
}

// ── All-campaigns import ──────────────────────────────────────────────

function AllCampaignsImport({ router }: { router: ReturnType<typeof useRouter> }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [allParsed, setAllParsed] = useState<AllCampaignsParsed | null>(null);
  /** Per-campaign selected rows: Map<campaign_id, Set<"sheet:row">> */
  const [selectedByCampaign, setSelectedByCampaign] = useState<Map<string, Set<string>>>(new Map());
  const [appliedResults, setAppliedResults] = useState<AllCampaignApplyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, startParseTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setAllParsed(null);
    setSelectedByCampaign(new Map());
    setAppliedResults(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(f: File) {
    setError(null);
    setFile(f);
    startParseTransition(async () => {
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/ingest-tracker/parse-all", { method: "POST", body: form });
        const json = await res.json();
        if (!json.ok) { setError(json.error ?? "Parse failed"); return; }
        const ap = json.result as AllCampaignsParsed;
        setAllParsed(ap);

        // Default selection: all writable rows, no warnings.
        const sel = new Map<string, Set<string>>();
        for (const entry of ap.campaigns) {
          if (!entry.parsed || !entry.campaign_id) continue;
          const s = new Set<string>();
          for (const row of entry.parsed.rows) {
            if ((row.planned_action === "insert" || row.planned_action === "update") && row.warnings.length === 0) {
              s.add(`${row.sheet_name}:${row.row_number}`);
            }
          }
          sel.set(entry.campaign_id, s);
        }
        setSelectedByCampaign(sel);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Parse failed");
      }
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function toggleRow(campaignId: string, key: string) {
    setSelectedByCampaign((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(campaignId) ?? []);
      if (s.has(key)) s.delete(key); else s.add(key);
      next.set(campaignId, s);
      return next;
    });
  }

  function selectAllForCampaign(entry: AllCampaignEntry) {
    if (!entry.parsed || !entry.campaign_id) return;
    const s = new Set(
      entry.parsed.rows
        .filter((r) => r.planned_action === "insert" || r.planned_action === "update")
        .map((r) => `${r.sheet_name}:${r.row_number}`),
    );
    setSelectedByCampaign((prev) => { const next = new Map(prev); next.set(entry.campaign_id!, s); return next; });
  }

  function clearAllForCampaign(campaignId: string) {
    setSelectedByCampaign((prev) => { const next = new Map(prev); next.set(campaignId, new Set()); return next; });
  }

  async function applyAll() {
    if (!file || !allParsed) return;
    setError(null);
    startApplyTransition(async () => {
      try {
        const campaigns = allParsed.campaigns
          .filter((e) => e.campaign_id && e.parsed)
          .map((e) => {
            const sel = selectedByCampaign.get(e.campaign_id!) ?? new Set<string>();
            return {
              campaign_id: e.campaign_id!,
              apply: e.parsed!.rows
                .filter((r) => sel.has(`${r.sheet_name}:${r.row_number}`))
                .map((r) => ({ sheet_name: r.sheet_name, row_number: r.row_number })),
            };
          })
          .filter((c) => c.apply.length > 0);

        if (campaigns.length === 0) {
          setError("No rows selected across any campaign.");
          return;
        }

        const form = new FormData();
        form.append("file", file);
        form.append("campaigns", JSON.stringify(campaigns));
        const res = await fetch("/api/ingest-tracker/apply-all", { method: "POST", body: form });
        const json = await res.json();
        if (!json.ok) { setError(json.error ?? "Apply failed"); return; }
        setAppliedResults(json.results as AllCampaignApplyResult[]);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Apply failed");
      }
    });
  }

  // ── Render ─────────────────────────────────────────────────────

  if (appliedResults) {
    const totalInserted = appliedResults.reduce((n, r) => n + r.result.inserted, 0);
    const totalUpdated = appliedResults.reduce((n, r) => n + r.result.updated, 0);
    return (
      <section style={cardStyle}>
        <h2 style={cardTitleStyle}>✓ All-campaigns ingest complete</h2>
        <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "0 0 14px 0" }}>
          {totalInserted + totalUpdated} total rows written across {appliedResults.length} campaign{appliedResults.length === 1 ? "" : "s"}.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {appliedResults.map((r) => (
            <div key={r.campaign_id} style={{ padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-alt)", fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{r.campaign_name}</div>
              <span style={{ color: "var(--green)" }}>{r.result.inserted} inserted</span>
              {" · "}
              <span style={{ color: "var(--accent)" }}>{r.result.updated} updated</span>
              {r.result.duplicates > 0 && <span style={{ color: "var(--text-dim)" }}> · {r.result.duplicates} unchanged</span>}
              {r.result.errors.length > 0 && <span style={{ color: "var(--red, #dc2626)" }}> · {r.result.errors.length} errors</span>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button type="button" onClick={reset} style={buttonStyle("primary")}>Import another file</button>
          <a href="/tracker" style={{ ...buttonStyle("secondary"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            View tracker →
          </a>
        </div>
      </section>
    );
  }

  if (allParsed) {
    const matchedEntries = allParsed.campaigns.filter((e) => e.parsed);
    const skippedEntries = allParsed.campaigns.filter((e) => !e.parsed);
    const totalSelected = [...selectedByCampaign.values()].reduce((n, s) => n + s.size, 0);

    return (
      <>
        {/* Summary header */}
        <div style={{ padding: "14px 18px", marginBottom: 14, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-alt)", fontSize: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
            All-campaigns preview — {allParsed.filename}
          </div>
          <div style={{ color: "var(--text-dim)", lineHeight: 1.6 }}>
            <b style={{ color: "var(--text)" }}>{matchedEntries.length}</b> campaign{matchedEntries.length === 1 ? "" : "s"} detected
            {skippedEntries.length > 0 && <> · <b style={{ color: "var(--amber)" }}>{skippedEntries.length}</b> unmatched groups</>}
            {allParsed.skipped_info_groups.length > 0 && <> · shared columns ignored ({allParsed.skipped_info_groups.join(", ")})</>}
          </div>
          <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
            <b>{totalSelected}</b> row{totalSelected === 1 ? "" : "s"} selected across all campaigns.
          </div>
        </div>

        {/* Skipped groups */}
        {skippedEntries.map((e) => (
          <div key={e.group_name} style={{ padding: "10px 14px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-alt)", fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: "var(--amber)" }}>{e.group_name}</span>
            <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>{e.skip_reason}</span>
          </div>
        ))}

        {/* Per-campaign preview sections */}
        {matchedEntries.map((entry) => {
          if (!entry.parsed || !entry.campaign_id) return null;
          const sel = selectedByCampaign.get(entry.campaign_id) ?? new Set<string>();
          return (
            <div key={entry.campaign_id} style={{ marginBottom: 20 }}>
              {/* Campaign header */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{entry.campaign_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {entry.parsed.new_campaign_partner_count} new · {entry.parsed.update_count} update · {entry.parsed.matched_count} matched
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => selectAllForCampaign(entry)} style={buttonStyle("secondary")}>Select all</button>
                  <button type="button" onClick={() => clearAllForCampaign(entry.campaign_id!)} style={buttonStyle("secondary")}>Clear</button>
                </div>
              </div>
              <PreviewTable
                parsed={entry.parsed}
                selected={sel}
                toggleRow={(key) => toggleRow(entry.campaign_id!, key)}
              />
            </div>
          );
        })}

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={reset} style={buttonStyle("secondary")}>Cancel</button>
          <button
            type="button"
            onClick={applyAll}
            disabled={isApplying || totalSelected === 0}
            style={buttonStyle("primary")}
          >
            {isApplying ? "Applying…" : `Apply ${totalSelected} row${totalSelected === 1 ? "" : "s"} across all campaigns →`}
          </button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </>
    );
  }

  return (
    <>
      <DropZone
        dragOver={dragOver}
        isParsing={isParsing}
        fileInputRef={fileInputRef}
        onDrop={onDrop}
        onDragOver={() => { if (!dragOver) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onFileChange={onFileChange}
        hint="Auto-detects SkySails, FishFrom, Panatere column groups from row 1 headers"
      />
      {error ? <ErrorBanner message={error} /> : null}
    </>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────

function DropZone({
  dragOver,
  isParsing,
  fileInputRef,
  onDrop,
  onDragOver,
  onDragLeave,
  onFileChange,
  hint,
}: {
  dragOver: boolean;
  isParsing: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hint?: string;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: "56px 28px",
        border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 14,
        background: dragOver ? "rgba(79, 70, 229, 0.06)" : "var(--surface-alt)",
        textAlign: "center",
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
      }}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        {isParsing ? "Reading the file…" : "Drop your tracker xlsx here — or click to browse"}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, maxWidth: 460, margin: "0 auto" }}>
        Accepts <code>.xlsx</code>, <code>.xls</code>, <code>.csv</code> up to 20 MB.
        {hint ? <><br /><span style={{ marginTop: 4, display: "inline-block" }}>{hint}</span></> : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={onFileChange}
      />
    </div>
  );
}

function PreviewHeader({
  parsed,
  selectedCount,
}: {
  parsed: ParsedTracker;
  selectedCount: number;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        marginBottom: 14,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--surface-alt)",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        Preview — {parsed.filename}
      </div>
      <div style={{ color: "var(--text-dim)" }}>
        <b style={{ color: "var(--text)" }}>{parsed.rows.length}</b> rows
        across {parsed.sheet_names.length} sheet{parsed.sheet_names.length === 1 ? "" : "s"} ·{" "}
        <b style={{ color: "var(--green)" }}>{parsed.matched_count}</b> matched ·{" "}
        <b style={{ color: "var(--amber)" }}>{parsed.ambiguous_count}</b> ambiguous ·{" "}
        <b style={{ color: "var(--red, #dc2626)" }}>{parsed.unmatched_count}</b> unmatched ·{" "}
        <b style={{ color: "var(--accent)" }}>{parsed.new_campaign_partner_count}</b> would be new tracker rows ·{" "}
        <b style={{ color: "var(--accent)" }}>{parsed.update_count}</b> would update existing.
        {parsed.missing_from_sheet > 0 ? (
          <> <b style={{ color: "var(--amber)" }}>{parsed.missing_from_sheet}</b> DB rows aren&rsquo;t in this sheet — old file?</>
        ) : null}
      </div>
      <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
        <b>{selectedCount}</b> row{selectedCount === 1 ? "" : "s"} selected for apply. Uncheck any you don&rsquo;t want written.
      </div>
    </div>
  );
}

function PreviewTable({
  parsed,
  selected,
  toggleRow,
}: {
  parsed: ParsedTracker;
  selected: Set<string>;
  toggleRow: (key: string) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--surface-alt)", color: "var(--text-dim)", textAlign: "left" }}>
            <th style={thStyle}>✓</th>
            <th style={thStyle}>Sheet</th>
            <th style={thStyle}>Row</th>
            <th style={thStyle}>Firm (from sheet)</th>
            <th style={thStyle}>Matched to</th>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Commentary</th>
            <th style={thStyle}>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {parsed.rows.map((row) => {
            const key = `${row.sheet_name}:${row.row_number}`;
            const isChecked = selected.has(key);
            const disabled =
              row.planned_action === "skip_no_match" ||
              row.planned_action === "skip_ambiguous";
            return (
              <tr
                key={key}
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  background: disabled
                    ? "var(--surface-alt)"
                    : isChecked
                      ? "rgba(79, 70, 229, 0.04)"
                      : "var(--surface)",
                  color: disabled ? "var(--text-faint)" : "var(--text)",
                }}
              >
                <td style={tdStyle}>
                  <input type="checkbox" checked={isChecked} disabled={disabled} onChange={() => toggleRow(key)} />
                </td>
                <td style={tdStyle}>{row.sheet_name}</td>
                <td style={tdStyle}>{row.row_number + 1}</td>
                <td style={tdStyle}>
                  <b>{row.firm_name ?? "—"}</b>
                  {row.contact_name ? <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{row.contact_name}</div> : null}
                </td>
                <td style={tdStyle}>
                  {row.matched_investor_firm ? (
                    <>
                      {row.matched_investor_firm}
                      <div style={{ color: "var(--text-faint)", fontSize: 10 }}>via {row.match_reason}</div>
                    </>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>
                      {row.match_reason === "ambiguous" ? "ambiguous" : "no match"}
                    </span>
                  )}
                </td>
                <td style={tdStyle}><ActionTag action={row.planned_action} /></td>
                <td style={tdStyle}>
                  {row.status_code ? (
                    <span style={{ fontFamily: "ui-monospace, monospace" }}>
                      {row.status_code}{" "}
                      <span style={{ color: "var(--text-dim)" }}>{row.status_label}</span>
                    </span>
                  ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                </td>
                <td style={{ ...tdStyle, maxWidth: 280 }}>
                  {row.commentary ? (
                    <span title={row.commentary}>
                      {row.commentary.length > 80 ? row.commentary.slice(0, 80) + "…" : row.commentary}
                    </span>
                  ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                </td>
                <td style={tdStyle}>
                  {row.warnings.length > 0 ? (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {row.warnings.map((w, i) => (
                        <li key={i} style={{ color: "var(--amber)", fontSize: 11 }}>{w}</li>
                      ))}
                    </ul>
                  ) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ApplyResultList({ result }: { result: ApplyResult }) {
  return (
    <>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px 0", fontSize: 13, lineHeight: 1.7 }}>
        <li><b style={{ color: "var(--green)" }}>{result.inserted}</b> new tracker rows inserted</li>
        <li><b style={{ color: "var(--accent)" }}>{result.updated}</b> existing rows updated</li>
        {result.duplicates > 0 && (
          <li><b style={{ color: "var(--text-dim)" }}>{result.duplicates}</b> identical to database — no changes needed (safe to re-import)</li>
        )}
        <li><b style={{ color: "var(--text-dim)" }}>{result.skipped}</b> skipped (unmatched / ambiguous / excluded from selection)</li>
      </ul>
      {result.errors.length > 0 ? (
        <div style={{ padding: "10px 12px", border: "1px solid var(--red-light, #fecaca)", borderRadius: 8, background: "var(--red-light, #fef2f2)", color: "var(--red, #dc2626)", fontSize: 12 }}>
          <b>{result.errors.length} errors:</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {result.errors.map((e, i) => <li key={i}><b>{e.firm}</b>: {e.reason}</li>)}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid var(--red-light, #fecaca)", borderRadius: 8, background: "var(--red-light, #fef2f2)", color: "var(--red, #dc2626)", fontSize: 12 }}>
      {message}
    </div>
  );
}

function ActionTag({ action }: { action: ParsedTrackerRow["planned_action"] }) {
  const map: Record<ParsedTrackerRow["planned_action"], { label: string; colour: string }> = {
    insert: { label: "Insert new", colour: "var(--green)" },
    update: { label: "Update existing", colour: "var(--accent)" },
    skip_no_match: { label: "Skip (no match)", colour: "var(--text-faint)" },
    skip_ambiguous: { label: "Skip (ambiguous)", colour: "var(--amber)" },
  };
  const d = map[action];
  return <span style={{ color: d.colour, fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>{d.label}</span>;
}

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  verticalAlign: "top",
};

const cardStyle: React.CSSProperties = {
  padding: "24px 22px",
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--surface)",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: "var(--text)",
  margin: "0 0 12px 0",
};

function buttonStyle(variant: "primary" | "secondary"): React.CSSProperties {
  if (variant === "primary") {
    return {
      padding: "8px 16px",
      fontSize: 13,
      fontWeight: 600,
      border: "1px solid var(--accent-dark, #4338ca)",
      borderRadius: 8,
      background: "var(--accent)",
      color: "white",
      cursor: "pointer",
    };
  }
  return {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
  };
}
