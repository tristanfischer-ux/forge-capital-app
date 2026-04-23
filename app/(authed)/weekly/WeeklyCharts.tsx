import type { PipelinePoint, StatusDistribution } from "@/lib/queries/weekly";

/**
 * WeeklyCharts — inline SVG charts for V4 §10 (Phase2-Mockup-V4.html
 * lines 1904-2044). Two charts side-by-side inside `.weekly-charts`:
 *
 *   - `PipelineVolumeChart` — 8-week line chart of sent / replies /
 *     meetings. Matches V4 lines 1906-1988.
 *   - `StatusDistributionChart` — paired stacked bars (prior vs this
 *     week), split into positive / mid / negative. Matches V4 lines
 *     1990-2044.
 *
 * Server-renderable — no state, no interactivity in V1. Every colour /
 * stroke / font-family string is lifted verbatim from V4 so the visual
 * matches the mockup by construction.
 *
 * The `hasData` prop guards against drawing phantom curves when the
 * contact_events table is empty for the campaign: instead we render
 * an honest "no activity recorded yet" hint, same viewBox to keep
 * surrounding layout stable.
 */

const CHART_COLOURS = {
  sent: "#4f46e5", // accent / indigo
  replies: "#059669", // green
  meetings: "#d97706", // amber
  grid: "#eef0f3",
  axisLabel: "#9ca3af",
  currentWeekLine: "#c7d2fe",
  labelCurrent: "#4f46e5",
  positive: "#059669",
  mid: "#9ca3af",
  negative: "#dc2626",
  barText: "#fff",
  baseline: "#e2e5ea",
  priorLabel: "#6b7280",
};

export function PipelineVolumeChart({
  points,
  hasData,
}: {
  points: PipelinePoint[];
  hasData: boolean;
}) {
  // V4 viewbox is 480x220 with a 40px left gutter and 200px baseline.
  const xStart = 70;
  const xEnd = 455;
  const yTop = 30;
  const yBottom = 200;

  // Y-scale: round up the max across all three series to the next
  // multiple of 5, minimum 5, so gridlines line up with the V4 style.
  const rawMax = Math.max(
    1,
    ...points.flatMap((p) => [p.sent, p.replies, p.meetings]),
  );
  const yMax = Math.max(5, Math.ceil(rawMax / 5) * 5);

  const ySteps = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

  const stride = points.length > 1 ? (xEnd - xStart) / (points.length - 1) : 0;
  const x = (i: number) => xStart + stride * i;
  const y = (v: number) => yBottom - (v / yMax) * (yBottom - yTop);

  const path = (field: keyof Pick<PipelinePoint, "sent" | "replies" | "meetings">) =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(p[field]).toFixed(1)}`).join(" ");

  const last = points.length - 1;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="chart-title">Pipeline volume &middot; last 8 weeks</div>
        <div className="chart-legend">
          <span className="leg-item">
            <span className="leg-dot" />
            Sent
          </span>
          <span className="leg-item">
            <span className="leg-dot plus" />
            Replies
          </span>
          <span className="leg-item">
            <span className="leg-dot neut" style={{ background: CHART_COLOURS.meetings }} />
            Meetings
          </span>
        </div>
      </div>
      <svg
        className="chart-svg"
        viewBox="0 0 480 220"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Pipeline volume over the last 8 weeks"
      >
        {/* grid */}
        <g stroke={CHART_COLOURS.grid} strokeWidth="1">
          {ySteps.map((_, i) => {
            const gy = yTop + ((yBottom - yTop) / (ySteps.length - 1)) * i;
            return <line key={`grid-${i}`} x1="40" y1={gy} x2="460" y2={gy} />;
          })}
        </g>

        {/* y-axis labels */}
        <g
          fill={CHART_COLOURS.axisLabel}
          fontSize="10"
          fontFamily="SF Mono, monospace"
          textAnchor="end"
        >
          {ySteps.map((val, i) => {
            const gy = yTop + ((yBottom - yTop) / (ySteps.length - 1)) * i + 4;
            return (
              <text key={`y-${i}`} x="34" y={gy}>
                {val}
              </text>
            );
          })}
        </g>

        {/* x-axis labels */}
        <g
          fill={CHART_COLOURS.axisLabel}
          fontSize="10"
          fontFamily="SF Mono, monospace"
          textAnchor="middle"
        >
          {points.map((p, i) => (
            <text key={`x-${i}`} x={x(i)} y="215">
              {p.weekLabel}
            </text>
          ))}
        </g>

        {hasData ? (
          <>
            {/* Sent line (indigo) */}
            <polyline
              points={path("sent")}
              fill="none"
              stroke={CHART_COLOURS.sent}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g fill={CHART_COLOURS.sent}>
              {points.map((p, i) => (
                <circle
                  key={`s-${i}`}
                  cx={x(i)}
                  cy={y(p.sent)}
                  r={i === last ? 4 : 3}
                  stroke={i === last ? "#fff" : undefined}
                  strokeWidth={i === last ? 2 : undefined}
                />
              ))}
            </g>

            {/* Replies line (green) */}
            <polyline
              points={path("replies")}
              fill="none"
              stroke={CHART_COLOURS.replies}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g fill={CHART_COLOURS.replies}>
              {points.map((p, i) => (
                <circle
                  key={`r-${i}`}
                  cx={x(i)}
                  cy={y(p.replies)}
                  r={i === last ? 4 : 3}
                  stroke={i === last ? "#fff" : undefined}
                  strokeWidth={i === last ? 2 : undefined}
                />
              ))}
            </g>

            {/* Meetings line (amber) */}
            <polyline
              points={path("meetings")}
              fill="none"
              stroke={CHART_COLOURS.meetings}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <g fill={CHART_COLOURS.meetings}>
              {points.map((p, i) => (
                <circle
                  key={`m-${i}`}
                  cx={x(i)}
                  cy={y(p.meetings)}
                  r={i === last ? 4 : 3}
                  stroke={i === last ? "#fff" : undefined}
                  strokeWidth={i === last ? 2 : undefined}
                />
              ))}
            </g>

            {/* Current week annotation */}
            <line
              x1={x(last)}
              y1={yTop}
              x2={x(last)}
              y2={yBottom}
              stroke={CHART_COLOURS.currentWeekLine}
              strokeDasharray="3,3"
            />
            <text
              x={x(last)}
              y="24"
              fill={CHART_COLOURS.labelCurrent}
              fontSize="10"
              fontWeight="700"
              textAnchor="end"
              fontFamily="-apple-system"
            >
              this week
            </text>
          </>
        ) : (
          <g>
            <text
              x="240"
              y="115"
              fill={CHART_COLOURS.axisLabel}
              fontSize="12"
              textAnchor="middle"
              fontFamily="-apple-system"
            >
              No activity recorded yet &mdash; contact events will populate once the Gmail sync runs.
            </text>
          </g>
        )}
      </svg>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.5,
          marginTop: 6,
        }}
      >
        {hasData
          ? "Curve reads left (8 weeks ago) to right (this week). Replies lag sends; V4 median is ~14 days."
          : "Chart renders from `contact_events`. Shape will appear as the Gmail ingest records outbound and inbound touches."}
      </div>
    </div>
  );
}

export function StatusDistributionChart({
  distribution,
}: {
  distribution: StatusDistribution;
}) {
  // 2026-04-23 rewrite: Tristan flagged the SVG paired-bars as "terrible"
  // — title wrapped, deltas floated in empty white space, segments hard
  // to compare. Replaced with two horizontal stacked bars (prior on top,
  // this-week below) normalised to the larger total so segment widths
  // compare apples-to-apples. Delta chips inline per segment.
  const { thisWeek, priorWeek } = distribution;
  const maxTotal = Math.max(1, thisWeek.total, priorWeek.total);

  const pctOf = (v: number) =>
    maxTotal === 0 ? 0 : Math.round((v / maxTotal) * 100);

  const deltaChip = (current: number, prior: number) => {
    if (prior === 0 && current === 0) return null;
    if (prior === 0) return `+${current}`;
    if (current === 0) return `-${prior}`;
    const diff = current - prior;
    if (diff === 0) return "flat";
    return `${diff > 0 ? "+" : ""}${diff}`;
  };

  const segments: Array<{
    key: "positive" | "mid" | "negative";
    label: string;
    colour: string;
    current: number;
    prior: number;
  }> = [
    {
      key: "positive",
      label: "Positive (+7 to +12)",
      colour: CHART_COLOURS.positive,
      current: thisWeek.positive,
      prior: priorWeek.positive,
    },
    {
      key: "mid",
      label: "Mid (+1 to +6)",
      colour: CHART_COLOURS.mid,
      current: thisWeek.mid,
      prior: priorWeek.mid,
    },
    {
      key: "negative",
      label: "Negative (-1 to -3)",
      colour: CHART_COLOURS.negative,
      current: thisWeek.negative,
      prior: priorWeek.negative,
    },
  ];

  const priorX = 110;
  const thisX = 270;
  const barW = 50;

  // Legacy SVG bar renderer removed 2026-04-23 — replaced by the
  // horizontal-stacked-bar WeekBar component.

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="chart-title">Status distribution</div>
        <div className="chart-legend">
          {segments.map((s) => (
            <span className="leg-item" key={s.key}>
              <span
                className="leg-dot"
                style={{ background: s.colour, borderColor: s.colour }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Two horizontal stacked bars — prior on top, this week below.
          Widths normalised to the larger total so bar-to-bar comparison
          is by-construction correct. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "14px 16px 10px",
        }}
      >
        <WeekBar
          label="Prior week"
          total={priorWeek.total}
          segments={segments.map((s) => ({
            colour: s.colour,
            key: s.key,
            value: s.prior,
          }))}
          maxTotal={maxTotal}
          pctOf={pctOf}
          muted
        />
        <WeekBar
          label="This week"
          total={thisWeek.total}
          segments={segments.map((s) => ({
            colour: s.colour,
            key: s.key,
            value: s.current,
          }))}
          maxTotal={maxTotal}
          pctOf={pctOf}
          muted={false}
        />
      </div>

      {/* Per-bucket delta row — three compact chips underneath the bars.
          Each chip shows prior → current and the raw delta, so the
          comparison is reading the same data three ways: bar segment
          width, raw counts, and delta chip. No empty right-hand gutter
          like the old SVG version. */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "0 16px 14px",
          flexWrap: "wrap",
        }}
      >
        {segments.map((s) => {
          const chip = deltaChip(s.current, s.prior);
          return (
            <div
              key={s.key}
              style={{
                flex: "1 1 140px",
                padding: "8px 10px",
                border: `1px solid ${s.colour}33`,
                borderRadius: 6,
                background: `${s.colour}0d`,
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: s.colour,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                  marginBottom: 2,
                }}
              >
                {s.key}
              </div>
              <div style={{ color: "var(--text)" }}>
                <b style={{ fontSize: 14 }}>{s.current}</b>
                <span style={{ color: "var(--text-dim)" }}>
                  {" "}this week · {s.prior} prior
                </span>
              </div>
              {chip ? (
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: 600,
                    fontSize: 11,
                    color:
                      chip === "flat"
                        ? "var(--text-dim)"
                        : s.key === "negative"
                          ? chip.startsWith("+")
                            ? "var(--red)"
                            : "var(--green)"
                          : chip.startsWith("+")
                            ? "var(--green)"
                            : "var(--red)",
                  }}
                >
                  Δ {chip}
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: "var(--text-faint)",
                  }}
                >
                  no activity
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legacy SVG removed 2026-04-23 — replaced by the horizontal
          bars + delta chips above. */}
      <svg style={{ display: "none" }} aria-hidden="true">
        <text
          x="0"
          y="0"
          fontSize="10"
          fontFamily="-apple-system"
        >
          legacy-placeholder
        </text>
      </svg>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.5,
          padding: "0 16px 14px",
        }}
      >
        Buckets match the 16-code status taxonomy. Partners counted by{" "}
        <code style={{ fontFamily: "'SF Mono', monospace", fontSize: 10 }}>
          last_contact_at
        </code>{" "}
        landing in the window.
      </div>
    </div>
  );
}

function WeekBar({
  label,
  total,
  segments,
  maxTotal,
  pctOf,
  muted,
}: {
  label: string;
  total: number;
  segments: Array<{ key: string; colour: string; value: number }>;
  maxTotal: number;
  pctOf: (v: number) => number;
  muted: boolean;
}) {
  const widthPct = maxTotal === 0 ? 0 : Math.round((total / maxTotal) * 100);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            color: muted ? "var(--text-dim)" : "var(--text)",
            fontWeight: muted ? 500 : 700,
          }}
        >
          {label}
        </span>
        <span style={{ color: "var(--text-dim)" }}>
          <b style={{ color: muted ? "var(--text-dim)" : "var(--text)" }}>
            {total}
          </b>{" "}
          total
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 22,
          background: "var(--surface-alt)",
          borderRadius: 4,
          overflow: "hidden",
          opacity: muted ? 0.8 : 1,
          border: "1px solid var(--border)",
          width: `${Math.max(widthPct, 4)}%`,
          display: "flex",
          minWidth: 20,
        }}
        title={`${total} total${
          total > 0
            ? ` (${segments.map((s) => `${s.value} ${s.key}`).join(", ")})`
            : ""
        }`}
      >
        {segments.map((s) => {
          const w = total === 0 ? 0 : (s.value / total) * 100;
          if (w === 0) return null;
          return (
            <div
              key={s.key}
              style={{
                width: `${w}%`,
                background: s.colour,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {w >= 8 ? s.value : null}
            </div>
          );
        })}
      </div>
      {total === 0 ? (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-faint)",
            fontStyle: "italic",
            marginTop: 2,
          }}
        >
          no activity
        </div>
      ) : null}
    </div>
  );
}
