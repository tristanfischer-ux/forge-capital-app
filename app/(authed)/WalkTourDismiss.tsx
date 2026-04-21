"use client";

import { useRouter } from "next/navigation";

/**
 * Tiny client-component for the "Hide tour" button inside the V4
 * walkthrough strip. Writes a `fc_tour_v4=hidden` cookie (1-year max
 * age, path=/) and triggers a router refresh so the strip's server
 * component re-evaluates on the next RSC payload.
 *
 * Styling: uses V4's `.wts-link` class verbatim (v4-mockup.css line
 * 660) — amber fg, bold, cursor pointer.
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
    <span
      className="wts-link"
      role="button"
      tabIndex={0}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dismiss();
        }
      }}
      aria-label="Hide the V4 walkthrough tour"
    >
      Hide tour
    </span>
  );
}
