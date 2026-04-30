"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Top-bar pill row — two-page navigation.
 *
 * Page 1: /discover — "Discovery" pill (truth database, search + match)
 * Page 2: /pipeline — section pills that anchor-scroll within the page
 *         (Approval, Automation, Templates, Review, Drafts, Tracker,
 *         Weekly, Gmail + Calendar)
 *
 * On /pipeline: pills are anchor scrolls with scroll-spy.
 * Elsewhere: pills are <Link> to /pipeline#anchor or /discover.
 *
 * V4 class vocabulary used verbatim from app/v4-mockup.css:
 *   - `.topnav`           — flex container
 *   - `.pill`             — base
 *   - `.pill.active`      — indigo fill + white text
 */

interface PillConfig {
  anchor: string;
  label: string;
  /** Full href when not on the pipeline page. */
  href: string;
  /** Stage number shown before the label. */
  number: number;
  /** Which page this pill belongs to. */
  page: "discover" | "pipeline";
}

const PILLS: PillConfig[] = [
  { anchor: "discover", label: "Discovery", href: "/discover", number: 1, page: "discover" },
  { anchor: "approval", label: "Approval", href: "/pipeline#approval", number: 2, page: "pipeline" },
  { anchor: "automation", label: "Automation", href: "/pipeline#automation", number: 3, page: "pipeline" },
  { anchor: "templates", label: "Templates", href: "/pipeline#templates", number: 4, page: "pipeline" },
  { anchor: "review", label: "Review", href: "/pipeline#review", number: 5, page: "pipeline" },
  { anchor: "drafts", label: "Drafts", href: "/pipeline#drafts", number: 6, page: "pipeline" },
  { anchor: "tracker", label: "Tracker", href: "/pipeline#tracker", number: 7, page: "pipeline" },
  { anchor: "weekly", label: "Weekly", href: "/pipeline#weekly", number: 8, page: "pipeline" },
  { anchor: "gmail-calendar", label: "Gmail", href: "/pipeline#gmail-calendar", number: 9, page: "pipeline" },
];

export function TopNav() {
  const pathname = usePathname() ?? "";
  const onPipeline = pathname === "/pipeline";
  const onDiscover = pathname === "/discover";
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (!onPipeline) {
      setActiveSection(null);
      return;
    }

    function currentSection(): string | null {
      const midline = window.innerHeight * 0.3;
      let currentId: string | null = null;
      for (const pill of PILLS) {
        if (pill.page !== "pipeline") continue;
        const el = document.getElementById(pill.anchor);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= midline) currentId = pill.anchor;
      }
      if (!currentId) currentId = "approval";
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

    setActiveSection(currentSection());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [onPipeline]);

  return (
    <nav className="topnav">
      {PILLS.map((pill) => {
        let active = false;
        if (pill.page === "discover") {
          active = onDiscover;
        } else if (onPipeline) {
          active = activeSection === pill.anchor;
        }

        const classes = ["pill"];
        if (active) classes.push("active");

        const pillContent = (
          <>
            <span className="pill-num">{pill.number}.</span>
            {pill.label}
          </>
        );

        // On /pipeline: pipeline pills are anchor scrolls
        if (onPipeline && pill.page === "pipeline") {
          return (
            <a
              key={pill.anchor}
              href={`#${pill.anchor}`}
              className={classes.join(" ")}
              aria-current={active ? "location" : undefined}
            >
              {pillContent}
            </a>
          );
        }

        // All other cases: Link navigation
        return (
          <Link
            key={pill.anchor}
            href={pill.href}
            aria-current={active ? "page" : undefined}
            className={classes.join(" ")}
          >
            {pillContent}
          </Link>
        );
      })}
    </nav>
  );
}
