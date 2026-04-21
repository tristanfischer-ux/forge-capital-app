import { cookies } from "next/headers";
import { WalkTourDismiss } from "./WalkTourDismiss";

/**
 * V4 walkthrough tour strip — the amber banner above the main content
 * area. Copy lifted verbatim from Phase2-Mockup-V4.html line 906–909.
 *
 * Persistence: the "Hide tour" button writes a cookie
 * `fc_tour_v4=hidden`; this server component reads that cookie and
 * returns null if set, so the strip stays hidden across sessions once
 * dismissed. The dismiss button itself is a tiny client component
 * (WalkTourDismiss) so the bulk of this strip remains server-rendered.
 *
 * The "three new surfaces" (automation, templates, weekly) are anchor
 * links into the same page on the mockup; in V1 those surfaces ship in
 * later sections, so the links currently do nothing (no `href`). Once
 * those sections land the anchors plug in here.
 */
export async function WalkTourStrip() {
  const cookieStore = await cookies();
  const dismissed = cookieStore.get("fc_tour_v4")?.value === "hidden";
  if (dismissed) return null;

  return (
    <div
      className="mb-4 flex items-center gap-3 rounded-[10px] border border-dashed px-4 py-[9px] text-[12px] leading-snug"
      style={{ background: "#fef9c3", borderColor: "#facc15", color: "#713f12" }}
      role="region"
      aria-label="V4 walkthrough tour"
    >
      <span
        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ background: "#ca8a04" }}
        aria-hidden="true"
      >
        i
      </span>
      <div className="flex-1" style={{ color: "#713f12" }}>
        <b style={{ color: "#713f12" }}>V4 walkthrough:</b> three new surfaces
        to notice &mdash;{" "}
        <span className="font-semibold underline decoration-dotted underline-offset-2">
          the automation pipeline
        </span>{" "}
        (where every partner sits in the flow),{" "}
        <span className="font-semibold underline decoration-dotted underline-offset-2">
          two-template email writer
        </span>{" "}
        (asking-for-money vs offering-money), and{" "}
        <span className="font-semibold underline decoration-dotted underline-offset-2">
          weekly counterpart update with charts
        </span>
        . Numbered callouts guide you through each.
      </div>
      <WalkTourDismiss />
    </div>
  );
}
