import type { ReactNode } from "react";

/**
 * SectionHead — shared header strip above every authed section.
 *
 * 1:1 port of V4 `.section-head` / `.section-title` / `.section-sub`
 * (v4-mockup.css lines 249-253). Pairs a title + one-line subtitle on
 * the left with an optional right slot for actions (buttons, links,
 * evidence chips).
 *
 * Deliberately slim — no presentation variants. Callers pass plain
 * nodes for the right slot; if they want a V4 `.section-link` they
 * emit `<span className="section-link">…</span>` themselves.
 */
export function SectionHead({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div style={{ minWidth: 0 }}>
        <div className="section-title" role="heading" aria-level={1}>
          {title}
        </div>
        {subtitle ? <div className="section-sub">{subtitle}</div> : null}
      </div>
      {right ? (
        <div style={{ display: "flex", flexShrink: 0, gap: 8, alignItems: "center" }}>
          {right}
        </div>
      ) : null}
    </div>
  );
}
