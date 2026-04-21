import type { TrackerRow } from "@/lib/queries/tracker";
import { STATUS_CODES } from "@/lib/status-codes";

/**
 * Per-status count strip above the tracker grid. Gives Tristan an
 * at-a-glance read on where a campaign sits: how many drafted, how
 * many sent, how many responded, how many declined. Derived from the
 * same rows the table renders — no extra DB hit.
 *
 * Shows only statuses actually present (so the strip stays short).
 * Unknown / null status is surfaced as "— unset —" so rows with no
 * status don't silently disappear from the count.
 */

interface Bucket {
  code: string | null;
  label: string;
  count: number;
  family: "committed" | "progressing" | "pending" | "dead" | "unset";
}

const FAMILY_CLASS: Record<Bucket["family"], string> = {
  committed: "border-[#bbf7d0] bg-green-light text-green",
  progressing: "border-[#c7d2fe] bg-accent-softer text-accent-dark",
  pending: "border-[#fde68a] bg-amber-light text-amber",
  dead: "border-[#fecaca] bg-red-light text-red",
  unset: "border-border bg-surface-alt text-text-dim",
};

function bucketsFrom(rows: TrackerRow[]): Bucket[] {
  const counts = new Map<string | null, number>();
  for (const r of rows) {
    const key = r.status_code;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out: Bucket[] = [];
  // Ordered per the 16-code legend (committed → dead), then unset at the end.
  for (const s of STATUS_CODES) {
    const n = counts.get(s.code);
    if (!n) continue;
    out.push({ code: s.code, label: s.label, count: n, family: s.family });
  }
  const unsetCount = counts.get(null) ?? 0;
  if (unsetCount > 0) {
    out.push({ code: null, label: "— unset —", count: unsetCount, family: "unset" });
  }
  return out;
}

export function StatusSummary({ rows }: { rows: TrackerRow[] }) {
  const buckets = bucketsFrom(rows);
  if (buckets.length === 0) return null;

  const total = rows.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium text-text-dim">
        {total} {total === 1 ? "row" : "rows"} ·
      </span>
      {buckets.map((b) => (
        <span
          key={b.code ?? "unset"}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${FAMILY_CLASS[b.family]}`}
          title={`${b.count} × ${b.label}`}
        >
          {b.code ? (
            <span className="font-mono text-[10px] opacity-70">{b.code}</span>
          ) : null}
          <span>{b.label}</span>
          <span className="rounded bg-white/60 px-1 py-0 font-mono text-[10px] tabular-nums">
            {b.count}
          </span>
        </span>
      ))}
    </div>
  );
}
