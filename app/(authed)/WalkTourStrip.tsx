import { cookies } from "next/headers";
import { WalkTourDismiss } from "./WalkTourDismiss";

/**
 * V4 walkthrough tour strip — 1:1 port of Phase2-Mockup-V4.html lines
 * 905-910. Amber dashed banner above the main content that introduces
 * the three new surfaces (automation, templates, weekly).
 *
 * V4 class vocabulary (v4-mockup.css lines 651-660):
 *   - `.walk-tour-strip`   — dashed amber container
 *   - `.wts-ico`           — circular "i" badge
 *   - `.wts-spacer`        — flex spacer before the link
 *   - `.wts-link`          — "Hide tour" action (rendered by
 *                            WalkTourDismiss, styled via .wts-link)
 *
 * Persistence: the "Hide tour" button writes a `fc_tour_v4=hidden`
 * cookie; this server component reads that cookie and returns null if
 * set so the strip stays hidden across sessions once dismissed.
 *
 * The three inline anchors (automation / templates / weekly) point at
 * V4's single-page anchor targets. Those sections haven't shipped in
 * V1; the hrefs stay in the DOM so they light up automatically the
 * moment those sections land.
 */
export async function WalkTourStrip() {
  const cookieStore = await cookies();
  const dismissed = cookieStore.get("fc_tour_v4")?.value === "hidden";
  if (dismissed) return null;

  return (
    <div className="walk-tour-strip" role="region" aria-label="V4 walkthrough tour">
      <span className="wts-ico" aria-hidden="true">
        i
      </span>
      <div>
        <b>V4 walkthrough:</b> three new surfaces to notice &mdash;{" "}
        <a href="#automation">the automation pipeline</a> (where every
        partner sits in the flow),{" "}
        <a href="#templates">two-template email writer</a> (asking-for-money
        vs offering-money), and{" "}
        <a href="#weekly">weekly counterpart update with charts</a>. Numbered
        callouts guide you through each.
      </div>
      <span className="wts-spacer" />
      <WalkTourDismiss />
    </div>
  );
}
