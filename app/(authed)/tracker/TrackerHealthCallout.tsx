/**
 * Tracker-health footer callout — V4 §2 `.walk-callout` (line 1868).
 * Sits directly below the master-sheet grid, yellow dashed background
 * with the numbered "5" circle on the left. V4 copy quoted verbatim so
 * the narrative — pool-match → Stephan approved → emails verified →
 * draft sent → reply received — matches the mockup.
 *
 * This is a static copy block; no props. If/when the copy changes we
 * update V4 first, then mirror here (that's the parity workflow).
 */
export function TrackerHealthCallout() {
  return (
    <div className="walk-callout">
      <span className="wc-num">5</span>
      <b>The Regeneration.VC row shows the full transition arc in one place:</b>{" "}
      pool-match → synthesis pushed → Stephan approved → emails verified →
      draft generated → sent → reply received (<b>+3 → +6</b>). Each entry
      carries its date. The legend codes are deterministic — same vocabulary
      that ships in the weekly update to Stephan.
    </div>
  );
}
