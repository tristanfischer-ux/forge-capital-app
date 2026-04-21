"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Active-state aware nav pill — port of V4 `.topnav .pill` / `.pill.active`
 * (v4-mockup.css lines 45-50). All styling lives in V4's CSS; this
 * component's only job is to decide whether to emit the `active` modifier
 * class based on the current pathname.
 *
 * V4 class vocabulary used here:
 *   - `.pill`            — base
 *   - `.pill.active`     — indigo fill + white text
 *   - `.pill.auto`       — pink "NEW" ribbon (automation pill)
 *
 * Split out into a client component so the layout itself stays a server
 * component (it awaits `listActiveCampaigns`).
 */
export function NavPill({
  href,
  label,
  auto,
}: {
  href: string;
  label: string;
  /** Emit V4's `.pill.auto` modifier — adds the "NEW" ribbon. */
  auto?: boolean;
}) {
  const pathname = usePathname() ?? "";
  // A pill matches when the URL starts with its href (so /tracker/<id>
  // still lights up the Tracker pill). Root "/" is handled specially.
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  const classes = ["pill"];
  if (active) classes.push("active");
  if (auto) classes.push("auto");

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={classes.join(" ")}
    >
      {label}
    </Link>
  );
}
