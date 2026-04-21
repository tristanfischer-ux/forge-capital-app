import type { ReactNode } from "react";

/**
 * SectionHead — shared header strip above every authed section.
 *
 * Port of Phase2-Mockup-V4.html `.section-head` (V4 line 296). Pairs a
 * title + one-line subtitle on the left with an optional right slot for
 * actions (buttons, links, evidence chips). Used above the tracker grid
 * and the matching pool so the visual rhythm is consistent across
 * sections, per V4's single-strip pattern.
 *
 * Deliberately slim — no presentation variants. Callers pass plain nodes.
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
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight text-text">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] text-text-dim">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
