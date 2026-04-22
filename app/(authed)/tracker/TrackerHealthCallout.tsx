/**
 * Tracker-health callout — V4 §2 `.walk-callout` shape.
 *
 * 2026-04-22: Rewritten to explain the status-code flow generically
 * rather than narrate a specific firm ("Regeneration.VC" / "Stephan")
 * that the V4 mockup used as demo data. The explanation is of the
 * STATUS VOCABULARY, which is evergreen.
 *
 * Should be placed ABOVE the tracker grid (per the "instructions at
 * top" rule) by the page that imports it.
 */
export function TrackerHealthCallout() {
  return (
    <div className="walk-callout">
      <span className="wc-num">5</span>
      <b>How to read this tracker.</b> Every row carries a status code
      from a locked 16-step vocabulary: <code>+0</code> pending approval
      through <code>+12</code> committed, with <code>-1</code> declined,{" "}
      <code>-2</code> bounced, <code>-3</code> disqualified for the
      drops. Commentary is appended chronologically with a{" "}
      <code>[YYYY-MM-DD]</code> date chip so you can retrace the arc.
      The same vocabulary drives the weekly update — same words
      everywhere means no rewording between surfaces.
    </div>
  );
}
