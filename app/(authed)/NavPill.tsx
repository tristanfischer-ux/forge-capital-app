"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Scroll-anchor aware nav pill — port of V4 `.topnav .pill` / `.pill.active`
 * (v4-mockup.css lines 45-50). All styling lives in V4's CSS; this
 * component's only job is to decide the correct navigation semantics
 * based on the current pathname.
 *
 * V4 class vocabulary used here:
 *   - `.pill`            — base
 *   - `.pill.active`     — indigo fill + white text
 *   - `.pill.auto`       — pink "NEW" ribbon (automation pill)
 *
 * Behaviour (per the single-page architecture locked in CLAUDE.md):
 *   - If current path is `/home`: pill is an in-page `<a href="#anchor">`
 *     — the browser smooth-scrolls (CSS `scroll-behavior: smooth`), no
 *     Next.js navigation fires.
 *   - Any other route (deep-links like /tracker, /match, etc.): pill is
 *     a `<Link href="/home#anchor">` — the user lands on /home with the
 *     section in view.
 *
 * We don't try to derive an "active" state from scroll position (would
 * need IntersectionObserver and the V1 value is low). On /home no pill
 * is marked active. On deep-link routes the legacy matching logic stays
 * so the pill for the current route still highlights where applicable
 * (useful on, e.g., /tracker where someone is viewing the deep-link).
 *
 * Split into a client component so the layout itself stays a server
 * component (it awaits `listActiveCampaigns`).
 */
export function NavPill({
  anchor,
  label,
  deepLinkPath,
  auto,
}: {
  /** V4 anchor id, e.g. `find-a-match`. */
  anchor: string;
  label: string;
  /** Deep-link route this pill maps to (for active-state on that route).
   *  Optional — some sections have no route yet. */
  deepLinkPath?: string;
  /** Emit V4's `.pill.auto` modifier — adds the "NEW" ribbon. */
  auto?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const onHome = pathname === "/home";

  // Active-state (only applies when NOT on /home — scroll-based active
  // detection on /home is intentionally deferred). On deep-link routes,
  // highlight the pill whose deepLinkPath matches the current path.
  const active =
    !onHome && deepLinkPath
      ? pathname === deepLinkPath || pathname.startsWith(`${deepLinkPath}/`)
      : false;

  const classes = ["pill"];
  if (active) classes.push("active");
  if (auto) classes.push("auto");

  // On /home: plain anchor — browser handles scroll. No Next navigation.
  if (onHome) {
    return (
      <a href={`#${anchor}`} className={classes.join(" ")}>
        {label}
      </a>
    );
  }

  // Elsewhere: Link to /home with the anchor — brings the user to the
  // single-page home with the section scrolled into view.
  return (
    <Link
      href={`/home#${anchor}`}
      aria-current={active ? "page" : undefined}
      className={classes.join(" ")}
    >
      {label}
    </Link>
  );
}
