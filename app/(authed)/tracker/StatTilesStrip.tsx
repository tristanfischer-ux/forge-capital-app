import type { TrackerRow } from "@/lib/queries/tracker";
import { StatTiles, type StatTile } from "../StatTiles";

/**
 * Tracker campaign-level stat tiles — port of V4 `.weekly-grid-stats` +
 * `.wk-stat` as a section-above-the-grid strip. Surfaces four aggregate
 * counts drawn from the same rows the grid renders (no extra DB hit).
 *
 * The four tiles match the brief spec (§1 of V4 cutover):
 *   1. Total partners — how many campaign_partners rows for this campaign.
 *   2. Drafted — +2 Drafted status from the 16-code vocabulary.
 *   3. Responded — +6 Response received. We deliberately show the first
 *      "good reply" signal; higher codes (+7…+12) stack on top of it and
 *      are surfaced by the per-status summary under the grid.
 *   4. Bounced — partners whose email_tier is 'bounced'. This is the
 *      replacement-hunt signal — at this count ≥1 the founder is at
 *      Gmail-account-suspension risk.
 *
 * Every number is computed live from the in-memory rows array — never
 * fabricated. Zero is rendered as "0" not hidden, so the empty state is
 * honest. The brief requires a trend indicator per tile but no source of
 * weekly delta exists yet (no history table in V1), so we render tiles
 * without deltas. Once a per-week snapshot lands, deltas plug in here.
 */
export function TrackerStatTilesStrip({ rows }: { rows: TrackerRow[] }) {
  const total = rows.length;

  // +2 Drafted — ready to send
  const drafted = rows.filter((r) => r.status_code === "+2").length;

  // +6 Response received — first useful reply signal
  const responded = rows.filter((r) => r.status_code === "+6").length;

  // email_tier='bounced' AND / OR status_code='-2' Bounced. A partner can
  // have an address that has bounced without the campaign_partners row
  // being advanced to the -2 status yet (tier lands on the mirror first).
  // We count by email_tier — that's the honest read on "how many Gmail
  // bounces are sitting in this campaign right now".
  const bounced = rows.filter((r) => r.email_tier === "bounced").length;

  const tiles: StatTile[] = [
    {
      id: "total",
      value: String(total),
      label: "Total partners",
      tone: "accent",
    },
    {
      id: "drafted",
      value: String(drafted),
      label: "Drafted",
      tone: "accent",
    },
    {
      id: "responded",
      value: String(responded),
      label: "Responded",
      tone: responded > 0 ? "green" : "neutral",
    },
    {
      id: "bounced",
      value: String(bounced),
      label: "Bounces need replacement",
      tone: bounced > 0 ? "red" : "neutral",
    },
  ];

  return <StatTiles tiles={tiles} />;
}
