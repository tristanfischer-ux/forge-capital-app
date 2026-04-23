"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphEntityKind,
  GraphNeighbourhoodData,
  GraphNode,
} from "@/lib/queries/graph-neighbourhood";

/**
 * D3-force graph viewer. Centred node fixed at origin; neighbours
 * settle via repulsion + link forces. Drag to move nodes. Click to
 * navigate to the full profile. Uses V4 design tokens.
 */

interface D3Node extends GraphNode, SimulationNodeDatum {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

type D3Link = SimulationLinkDatum<D3Node> & {
  kind: GraphEdgeKind;
  label: string | null;
};

const WIDTH = 920;
const HEIGHT = 620;
const NODE_RADIUS = {
  investor: 18,
  partner: 14,
  portfolio: 14,
} satisfies Record<GraphEntityKind, number>;
const CENTER_BONUS = 8; // center node gets a bigger radius

// V4-token-backed palette (mirrors the tag-chip family).
const COLORS: Record<GraphEntityKind, { fill: string; stroke: string; text: string }> = {
  investor: { fill: "#eef2ff", stroke: "#4f46e5", text: "#312e81" },
  partner: { fill: "#ecfdf5", stroke: "#059669", text: "#064e3b" },
  portfolio: { fill: "#fef3c7", stroke: "#b45309", text: "#7c2d12" },
};

const EDGE_STYLES: Record<GraphEdgeKind, { dash: string; color: string }> = {
  employs: { dash: "0", color: "#cbd5e1" },
  backs: { dash: "0", color: "#a5b4fc" },
  co_backer: { dash: "4 3", color: "#fcd34d" },
  shares_portfolio: { dash: "4 3", color: "#93c5fd" },
  cross_firm: { dash: "2 4", color: "#86efac" },
  colleague: { dash: "0", color: "#e5e7eb" },
};

export function GraphView({ data }: { data: GraphNeighbourhoodData }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  // Pointer-down position per node — used to disambiguate tap-to-navigate
  // from drag-to-reposition. The original implementation called
  // setPointerCapture immediately on pointerdown, which on most browsers
  // suppresses the synthesised click that would otherwise navigate via
  // <a>. Now we capture only after the pointer moves >5px and route the
  // navigation manually via next/navigation when a pointerup arrives
  // without significant movement.
  const dragStateRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const DRAG_THRESHOLD_PX = 5;

  // d3-force simulation — mutated in-place, re-renders via `tick` state.
  const { nodes, links } = useMemo(() => {
    const ns: D3Node[] = data.nodes.map((n) => ({
      ...n,
      x: n.isCenter ? WIDTH / 2 : WIDTH / 2 + (Math.random() - 0.5) * 200,
      y: n.isCenter ? HEIGHT / 2 : HEIGHT / 2 + (Math.random() - 0.5) * 200,
      fx: n.isCenter ? WIDTH / 2 : null,
      fy: n.isCenter ? HEIGHT / 2 : null,
    }));
    const ls: D3Link[] = data.edges.map((e: GraphEdge) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
      label: e.label,
    }));
    return { nodes: ns, links: ls };
  }, [data]);

  useEffect(() => {
    const sim: Simulation<D3Node, D3Link> = forceSimulation<D3Node, D3Link>(nodes)
      .force(
        "link",
        forceLink<D3Node, D3Link>(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === "employs" ? 90 : 140))
          .strength(0.3),
      )
      .force("charge", forceManyBody().strength(-380))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.02))
      .force(
        "collide",
        forceCollide<D3Node>().radius(
          (d) => NODE_RADIUS[d.kind] + (d.isCenter ? CENTER_BONUS : 0) + 6,
        ),
      )
      .on("tick", () => setTick((t) => t + 1));
    sim.alpha(1).restart();
    return () => {
      sim.stop();
    };
  }, [nodes, links]);

  // Pointer handlers — disambiguate tap (navigate) from drag (reposition).
  // Capture is deferred until the pointer crosses DRAG_THRESHOLD_PX so that
  // a quick tap fires onPointerUp on the same target and navigates.
  function onPointerDown(e: React.PointerEvent, id: string) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    dragStateRef.current = {
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const state = dragStateRef.current;
    if (!state) return;
    const dx = e.clientX - state.startClientX;
    const dy = e.clientY - state.startClientY;
    const dist = Math.hypot(dx, dy);

    if (!state.moved && dist < DRAG_THRESHOLD_PX) return;

    if (!state.moved) {
      // First move past the threshold — promote to drag, capture pointer
      // so subsequent moves outside the node still hit the SVG.
      state.moved = true;
      const node = nodes.find((n) => n.id === state.id);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
      const svg = svgRef.current;
      try {
        svg?.setPointerCapture(state.pointerId);
      } catch {
        // some browsers throw if the element doesn't own the pointer
      }
    }

    const node = nodes.find((n) => n.id === state.id);
    const svg = svgRef.current;
    if (!node || !svg) return;
    const rect = svg.getBoundingClientRect();
    node.fx = (e.clientX - rect.left) * (WIDTH / rect.width);
    node.fy = (e.clientY - rect.top) * (HEIGHT / rect.height);
    setTick((t) => t + 1);
  }
  function onPointerUp(_id: string) {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    if (!state) return;
    const svg = svgRef.current;
    if (svg && svg.hasPointerCapture(state.pointerId)) {
      svg.releasePointerCapture(state.pointerId);
    }
    if (!state.moved) {
      // Tap → navigate. Centre node has no useful destination (already
      // here) so we suppress its tap.
      const node = nodes.find((n) => n.id === state.id);
      if (node && !node.isCenter) {
        router.push(node.href);
      }
      return;
    }
    // Drag end — release the fixed position so the sim re-settles.
    const node = nodes.find((n) => n.id === state.id);
    if (node && !node.isCenter) {
      node.fx = null;
      node.fy = null;
    }
  }

  // Force `tick` to be read — React sees it via state, no need to touch here
  // but the render re-runs when state changes (see setTick).
  void tick;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface)",
        padding: 12,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          cursor: dragStateRef.current?.moved ? "grabbing" : "default",
        }}
        onPointerMove={onPointerMove}
      >
        {/* Edges */}
        {links.map((l, i) => {
          const s = (typeof l.source === "object" ? l.source : nodes.find((n) => n.id === l.source)) as D3Node | undefined;
          const t = (typeof l.target === "object" ? l.target : nodes.find((n) => n.id === l.target)) as D3Node | undefined;
          if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return null;
          const style = EDGE_STYLES[l.kind];
          return (
            <g key={i}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={style.color}
                strokeWidth={1.5}
                strokeDasharray={style.dash}
                opacity={0.85}
              />
              {l.label ? (
                <text
                  x={(s.x + t.x) / 2}
                  y={(s.y + t.y) / 2 - 4}
                  fontSize={9}
                  fill="var(--text-faint)"
                  textAnchor="middle"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {l.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          if (n.x == null || n.y == null) return null;
          const c = COLORS[n.kind];
          const r = NODE_RADIUS[n.kind] + (n.isCenter ? CENTER_BONUS : 0);
          const isHover = hover === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              onPointerDown={(e) => onPointerDown(e, n.id)}
              onPointerUp={() => onPointerUp(n.id)}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              style={{
                cursor: n.isCenter ? "default" : isHover ? "pointer" : "grab",
              }}
              role={n.isCenter ? undefined : "button"}
              tabIndex={n.isCenter ? undefined : 0}
              aria-label={
                n.isCenter
                  ? undefined
                  : `Open ${n.kind} profile for ${n.label} — tap to open, drag to move`
              }
              onKeyDown={(e) => {
                if (n.isCenter) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(n.href);
                }
              }}
            >
              <>
                <circle
                  r={r}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={n.isCenter || isHover ? 3 : 1.5}
                />
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fontSize={n.isCenter ? 13 : 11}
                  fontWeight={n.isCenter ? 700 : 500}
                  fill={c.text}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {truncate(n.label, n.isCenter ? 34 : 22)}
                </text>
                {n.meta ? (
                  <text
                    y={r + 27}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-faint)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {truncate(n.meta, 28)}
                  </text>
                ) : null}
              </>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 18,
          fontSize: 11,
          color: "var(--text-dim)",
          padding: "10px 6px 2px",
          flexWrap: "wrap",
        }}
      >
        <LegendSwatch kind="investor" label="Investor" />
        <LegendSwatch kind="partner" label="Partner" />
        <LegendSwatch kind="portfolio" label="Portfolio company" />
        <span style={{ color: "var(--text-faint)", marginLeft: "auto" }}>
          click node to open · drag to reposition
        </span>
      </div>

      {/* Jump-to row */}
      <div
        style={{
          marginTop: 8,
          padding: "8px 6px 2px",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <span>Jump to centre&rsquo;s profile:</span>
        <Link
          href={data.nodes[0]?.href ?? "/home"}
          className="partner-link"
          style={{ fontWeight: 500 }}
        >
          {data.centerLabel} →
        </Link>
      </div>
    </div>
  );
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: GraphEntityKind;
  label: string;
}) {
  const c = COLORS[kind];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: c.fill,
          border: `1.5px solid ${c.stroke}`,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
