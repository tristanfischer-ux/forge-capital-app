import { CapitalDiscover } from "../discover/CapitalDiscover";

export const dynamic = "force-dynamic";

/**
 * Match now searches the shared raise book (core/engage), not the
 * investors_mirror encyclopaedia. Same surface as Discover.
 */
export default function MatchPage() {
  return <CapitalDiscover />;
}
