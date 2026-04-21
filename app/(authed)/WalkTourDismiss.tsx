"use client";

import { useRouter } from "next/navigation";

/**
 * Tiny client-component for the "Hide tour" button inside the V4
 * walkthrough strip. Writes a `fc_tour_v4=hidden` cookie (1-year max
 * age, path=/) and triggers a router refresh so the strip's server
 * component re-evaluates its render on the next RSC payload.
 *
 * Kept as a sibling of WalkTourStrip (not inside it) so the parent
 * stays fully server-rendered — only this 200-byte button ships to
 * the client.
 */
export function WalkTourDismiss() {
  const router = useRouter();

  function dismiss() {
    // 1-year cookie — any non-trivial window. We re-show after clearing
    // site data, which matches user expectation ("hide" ≠ "forever").
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `fc_tour_v4=hidden; path=/; max-age=${maxAge}; samesite=lax`;
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      className="shrink-0 text-[12px] font-semibold"
      style={{ color: "#854d0e" }}
      aria-label="Hide the V4 walkthrough tour"
    >
      Hide tour
    </button>
  );
}
