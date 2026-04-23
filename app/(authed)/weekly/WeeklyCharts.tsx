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
  // Widened from V4's 380x220 → 500x220 on 2026-04-23 so the Prior/This
  // week labels and delta callouts don't crowd each other at this card's
  // rendered width. Bars remain 40px wide; delta callouts anchored to
  // the right gutter.
  const baseline = 190;
  const maxHeight = 170; // baseline - 20 for a small top gutter
  const maxTotal = Math.max(1, distribution.thisWeek.total, distribution.priorWeek.total);
  const scale = (v: number) => (v / maxTotal) * maxHeight;

  const priorX = 110;
  const thisX = 270;
  const barW = 50;

  const deltaPct = (current: number, prior: number): string => {
    if (prior === 0 && current === 0) return "no activity";
    if (prior === 0) return `+${current} new`;
    const pct = Math.round(((current - prior) / prior) * 100);
    if (pct === 0) return "flat";
    return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`;
  };

  const renderBar = (
    x: number,
    values: StatusDistribution["thisWeek"],
    colour: { pos: string; mid: string; neg: string },
  ) => {
    const negH = scale(values.negative);
    const midH = scale(values.mid);
    const posH = scale(values.positive);
    // Stack: negative on top, then mid, then positive — matches V4's
    // "Negatives up top, mid in the middle, positives at the base" order.
    const negY = baseline - posH - midH - negH;
    const midY = baseline - posH - midH;
    const posY = baseline - posH;

    const drawRect = (
      y: number,
      h: number,
      fill: string,
      label: number,
      key: string,
    ) =>
      h > 0 ? (
        <g key={key}>
          <rect x={x} y={y} width={barW} height={h} fill={fill} rx="2" />
          {h >= 14 ? (
            <text
              x={x + barW / 2}
              y={y + h / 2 + 4}
              fill={CHART_COLOURS.barText}
              fontSize="10"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="-apple-system"
            >
              {label}
            </text>
          ) : null}
        </g>
      ) : null;

    // Empty-state outline: when a week has zero activity, draw a dashed
    // ghost rectangle so both columns are visibly present. Without this,
    // "This week" collapses to just a text label and the chart looks
    // asymmetric (Tristan's 2026-04-23 "two columns, writing is weird"
    // report).
    if (values.total === 0) {
      return (
        <g key={`empty-${x}`}>
          <rect
            x={x}
            y={baseline - 30}
            width={barW}
            height={30}
            fill="none"
            stroke={CHART_COLOURS.baseline}
            strokeWidth="1"
            strokeDasharray="3 3"
            rx="2"
          />
          <text
            x={x + barW / 2}
            y={baseline - 12}
            fill={CHART_COLOURS.axisLabel}
            fontSize="10"
            textAnchor="middle"
            fontFamily="-apple-system"
          >
            no activity
          </text>
        </g>
      );
    }

    return (
      <>
        {drawRect(posY, posH, colour.pos, values.positive, `pos-${x}`)}
        {drawRect(midY, midH, colour.mid, values.mid, `mid-${x}`)}
        {drawRect(negY, negH, colour.neg, values.negative, `neg-${x}`)}
      </>
    );
  };

  const colours = {
    pos: CHART_COLOURS.positive,
    mid: CHART_COLOURS.mid,
    neg: CHART_COLOURS.negative,
  };

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="chart-title">Status distribution &middot; this week vs prior</div>
        <div className="chart-legend">
          <span className="leg-item">
            <span className="leg-dot plus" />
            Positive (+7 to +12)
          </span>
          <span className="leg-item">
            <span className="leg-dot neut" />
            Mid (+1 to +6)
          </span>
          <span className="leg-item">
            <span className="leg-dot neg" />
            Negative (-1 to -3)
          </span>
        </div>
      </div>
      <svg
        className="chart-svg"
        viewBox="0 0 500 220"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Status distribution this week versus prior week"
      >
        {/* baseline */}
        <line
          x1="90"
          y1={baseline}
          x2="470"
          y2={baseline}
          stroke={CHART_COLOURS.baseline}
          strokeWidth="1"
        />

        {/* PRIOR WEEK */}
        <g>
          <text
            x={priorX + barW / 2}
            y="210"
            fontSize="11"
            fill={CHART_COLOURS.priorLabel}
            textAnchor="middle"
            fontFamily="-apple-system"
          >
            Prior week
          </text>
          <text
            x={priorX + barW / 2}
            y="20"
            fontSize="10"
            fontFamily="SF Mono, monospace"
            fill={CHART_COLOURS.axisLabel}
            textAnchor="middle"
          >
            {distribution.priorWeek.total} total
          </text>
          {renderBar(priorX, distribution.priorWeek, colours)}
        </g>

        {/* THIS WEEK */}
        <g>
          <text
            x={thisX + barW / 2}
            y="210"
            fontSize="11"
            fill={CHART_COLOURS.sent}
            textAnchor="middle"
            fontWeight="700"
            fontFamily="-apple-system"
          >
            This week
          </text>
          <text
            x={thisX + barW / 2}
            y="20"
            fontSize="10"
            fontFamily="SF Mono, monospace"
            fill={CHART_COLOURS.sent}
            textAnchor="middle"
            fontWeight="700"
          >
            {distribution.thisWeek.total} total
          </text>
          {renderBar(thisX, distribution.thisWeek, colours)}
        </g>

        {/* Delta callouts */}
        <text
          x="400"
          y="90"
          fill={CHART_COLOURS.positive}
          fontSize="11"
          fontWeight="700"
          fontFamily="-apple-system"
        >
          {deltaPct(distribution.thisWeek.positive, distribution.priorWeek.positive)}
        </text>
        <text
          x="400"
          y="105"
          fill={CHART_COLOURS.priorLabel}
          fontSize="10"
          fontFamily="-apple-system"
        >
          positive
        </text>
        <text
          x="400"
          y="175"
          fill={CHART_COLOURS.priorLabel}
          fontSize="10"
          fontFamily="-apple-system"
        >
          negatives
        </text>
        <text
          x="400"
          y="190"
          fill={CHART_COLOURS.negative}
          fontSize="11"
          fontWeight="700"
          fontFamily="-apple-system"
        >
          {deltaPct(distribution.thisWeek.negative, distribution.priorWeek.negative)}
        </text>
      </svg>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.5,
          marginTop: 6,
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
