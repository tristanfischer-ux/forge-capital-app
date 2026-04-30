"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Client component for the "Ingest into tracker" CTA in the incoming
 * approval column. Approved rows are already persisted by
 * applyApprovalVerdicts — this button navigates to the tracker filtered
 * to show the recently approved (+1) rows so Tristan can see them in
 * context and proceed to drafting.
 *
 * When stats.approved === 0, the button is disabled with explanatory
 * copy — there's nothing to navigate to.
 */
export function IngestIntoTrackerButton({
  campaignId,
  approvedCount,
}: {
  campaignId: string;
  approvedCount: number;
}) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);
  const isEmpty = approvedCount === 0;

  function handleClick() {
    if (isEmpty || navigating) return;
    setNavigating(true);
    router.push(`/tracker?campaign=${campaignId}&tier=approved`);
  }

  return (
    <button
      type="button"
      className="ic-btn"
      disabled={isEmpty || navigating}
      onClick={handleClick}
      title={
        isEmpty
          ? "No approved rows to ingest yet — parse a reply first."
          : `View ${approvedCount} approved row${approvedCount === 1 ? "" : "s"} in the tracker`
      }
      style={isEmpty ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
    >
      {navigating ? "Opening tracker…" : "Ingest into tracker →"}
    </button>
  );
}
