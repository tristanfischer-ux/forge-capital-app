"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Top-bar pill row with scroll-spy. On /home the 8 pills are anchor
 * scrolls; the one matching the currently-visible section gets
 * `.pill.active` so the user can see where they are in the 10-section
 * scroll. On any deep-link route (/tracker, /match, …) the pills are
 * `<Link href="/home#anchor">` and the active state falls back to
 * pathname matching (existing V1 behaviour).
 *
 * V4 class vocabulary used verbatim from app/v4-mockup.css:
 *   - `.topnav`           — flex container
 *   - `.pill`             — base
 *   - `.pill.active`      — indigo fill + white text (V4 line 45-50)
 *   - `.pill.auto`        — pink "NEW" ribbon (automation pill only)
 *
 * Scroll-spy uses a scroll listener + rAF throttle rather than
 * IntersectionObserver. IO with rootMargin works well for "section
 * enters top zone" but gives awkward empty states at page top and page
 * bottom; the scroll-position check we do here is O(8) per frame which
 * is cheap, always picks exactly one pill, and handles the first-load
 * and bottom-of-page cases naturally.
 *
 * Replaces the old app/(authed)/NavPill.tsx which did per-pill routing
 * without shared scroll state.
 */

interface PillConfig {
  anchor: string;
  label: string;
  /** Route that deep-links to this section on its own. */
  deepLinkPath: string;
  /** V4 `.pill.auto` pink-ribbon modifier — automation pill only. */
  auto?: boolean;
}

const PILLS: PillConfig[] = [
  { anchor: "find-a-match", label: "Find a match", deepLinkPath: "/match" },
  { anchor: "approval", label: "Approval", deepLinkPath: "/approval" },
  { anchor: "automation", label: "Automation", deepLinkPath: "/pipeline", auto: true },
  { anchor: "templates", label: "Templates", deepLinkPath: "/templates" },
  { anchor: "review", label: "Review", deepLinkPath: "/review" },
  { anchor: "drafts", label: "Drafts", deepLinkPath: "/drafts" },
  { anchor: "tracker", label: "Tracker", deepLinkPath: "/tracker" },
  { anchor: "weekly", label: "Weekly", deepLinkPath: "/weekly" },
  { anchor: "inbox", label: "Inbox", deepLinkPath: "/inbox" },
];

export function TopNav() {
  const pathname = usePathname() ?? "";
  const onHome = pathname === "/home";
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (!onHome) {
      setActiveSection(null);
      return;
    }

    // Midline of the viewport-active zone: a section is "active" when
    // its top has crossed this y-offset from the viewport top. 30% is
    // comfortable — the top of a section reaches this line a beat
    // before the user's eye lands on its heading.
    function currentSection(): string | null {
      const midline = window.innerHeight * 0.3;
      let currentId: string | null = null;
      for (const { anchor } of PILLS) {
        const el = document.getElementById(anchor);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= midline) currentId = anchor;
      }
      // If we're above the first section's threshold, highlight the
      // first pill so the user always sees a "you are here" mark.
      if (!currentId) currentId = PILLS[0]?.anchor ?? null;
      return currentId;
    }

    let rafId: number | null = null;
    function onScroll() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setActiveSection(currentSection());
      });
    }

    // Initial sync (page may be scrolled mid-way on navigation).
    setActiveSection(currentSection());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [onHome]);

  return (
    <nav className="topnav">
      {PILLS.map((pill) => {
        const active = onHome
          ? activeSection === pill.anchor
          : pathname === pill.deepLinkPath
            || pathname.startsWith(`${pill.deepLinkPath}/`);

        const classes = ["pill"];
        if (active) classes.push("active");
        if (pill.auto) classes.push("auto");

        // On /home: plain anchor — browser's smooth-scroll (via the V4
        // CSS `scroll-behavior: smooth` on <html>) handles the scroll.
        // Elsewhere: Next <Link> back to /home with the anchor.
        if (onHome) {
          return (
            <a
              key={pill.anchor}
              href={`#${pill.anchor}`}
              className={classes.join(" ")}
              aria-current={active ? "location" : undefined}
            >
              {pill.label}
            </a>
          );
        }
        return (
          <Link
            key={pill.anchor}
            href={`/home#${pill.anchor}`}
            aria-current={active ? "page" : undefined}
            className={classes.join(" ")}
          >
            {pill.label}
          </Link>
        );
      })}
    </nav>
  );
}
