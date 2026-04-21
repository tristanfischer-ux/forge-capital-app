/**
 * StatTiles — reusable horizontal strip of stat tiles.
 *
 * Port of Phase2-Mockup-V4.html `.weekly-grid-stats` / `.wk-stat` pattern
 * (V4 lines 522–531). Each tile: big number + UPPERCASE label + optional
 * delta indicator ("▲ 4 vs last week" / "▼ 1" / "flat"). Used above the
 * tracker grid to surface aggregate campaign counts at a glance.
 *
 * Tile tones: accent (indigo, default), green (positive), red (bad),
 * neutral (plain). Mirrors V4's `.n.accent|green|red` modifier classes.
 *
 * Server-renderable — no state, no event handlers, no client bundle.
 */

export type StatTone = "accent" | "green" | "red" | "neutral";

export interface StatTileDelta {
  /** Arrow direction — "up" renders "▲" in green, "down" renders "▼" in red. */
  direction: "up" | "down" | "flat";
  /** Trailing copy, e.g. "4 vs last week" or "1 (good)" or "flat". */
  label: string;
}

export interface StatTile {
  /** Big numeric value. Pass as string so callers can format "0 / 276" etc. */
  value: string;
  /** Short uppercase label under the number. V4 keeps this to 1–3 words. */
  label: string;
  /** Colour modifier for the number, per V4. */
  tone?: StatTone;
  /** Optional trend delta shown below the label. */
  delta?: StatTileDelta | null;
  /** Stable key (V4 uses label implicitly — we're explicit for safety). */
  id: string;
}

const TONE_CLASS: Record<StatTone, string> = {
  accent: "text-accent",
  green: "text-green",
  red: "text-red",
  neutral: "text-text",
};

function deltaClass(dir: StatTileDelta["direction"]): string {
  if (dir === "up") return "text-green";
  if (dir === "down") return "text-red";
  return "text-text-dim";
}

function deltaGlyph(dir: StatTileDelta["direction"]): string {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  return "";
}

/**
 * Horizontal strip of tiles. Uses CSS grid with `grid-template-columns:
 * repeat(N, 1fr)` so the row scales evenly across the container width.
 * Matches V4's inline grid on `.weekly-grid-stats`.
 */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <div
      className="grid gap-2.5 rounded-[10px] border border-border bg-surface-alt p-4"
      style={{
        gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.id}
          className="rounded-[10px] border border-border bg-surface px-3.5 py-3"
        >
          <div
            className={`text-[22px] font-bold leading-none tracking-tight ${TONE_CLASS[t.tone ?? "neutral"]}`}
          >
            {t.value}
          </div>
          <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-text-dim">
            {t.label}
          </div>
          {t.delta ? (
            <div className={`mt-1 text-[11px] ${deltaClass(t.delta.direction)}`}>
              {deltaGlyph(t.delta.direction)}{" "}
              <span>{t.delta.label}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
