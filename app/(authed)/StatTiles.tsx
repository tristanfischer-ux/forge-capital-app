/**
 * StatTiles — reusable horizontal strip of stat tiles.
 *
 * 1:1 port of V4 `.weekly-grid-stats` / `.wk-stat` (v4-mockup.css lines
 * 475-484). Each tile renders: big number (`.n`, optional tone
 * modifier `.accent|green|red`), uppercase label (`.l`), and an
 * optional delta line (`.delta`, optional `.up|down` modifier).
 *
 * Wrapper: V4 uses `.weekly-grid-stats` which is a 5-col grid sitting
 * inside a `.weekly-wrap` card. Since callers pass variable-length
 * tile arrays, we dynamically override the grid-template-columns to
 * match the tile count while still emitting the `.weekly-grid-stats`
 * class for V4's padding / borders / background.
 *
 * Server-renderable — no state, no event handlers, no client bundle.
 */

export type StatTone = "accent" | "green" | "red" | "neutral";

export interface StatTileDelta {
  /** Arrow direction — maps to V4's `.delta.up` / `.delta.down`. */
  direction: "up" | "down" | "flat";
  /** Trailing copy, e.g. "4 vs last week" or "1 (good)" or "flat". */
  label: string;
}

export interface StatTile {
  /** Big numeric value. Pass as string so callers can format "0 / 276" etc. */
  value: string;
  /** Short uppercase label under the number. V4 keeps this to 1–3 words. */
  label: string;
  /** Tone modifier — maps to `.n.accent|green|red`. Default = plain text. */
  tone?: StatTone;
  /** Optional trend delta shown below the label. */
  delta?: StatTileDelta | null;
  /** Stable key for React. */
  id: string;
}

function toneClass(tone: StatTone | undefined): string {
  if (tone === "accent") return "n accent";
  if (tone === "green") return "n green";
  if (tone === "red") return "n red";
  return "n";
}

function deltaClass(dir: StatTileDelta["direction"]): string {
  if (dir === "up") return "delta up";
  if (dir === "down") return "delta down";
  return "delta";
}

function deltaGlyph(dir: StatTileDelta["direction"]): string {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  return "";
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <div
      className="weekly-grid-stats"
      style={{
        // V4 hard-codes 5 columns. Variable-length callers get an even
        // grid with the same gap/padding/background.
        gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
      }}
    >
      {tiles.map((t) => (
        <div key={t.id} className="wk-stat">
          <div className={toneClass(t.tone)}>{t.value}</div>
          <div className="l">{t.label}</div>
          {t.delta ? (
            <div className={deltaClass(t.delta.direction)}>
              {deltaGlyph(t.delta.direction)} <span>{t.delta.label}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
