"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Active-state aware nav pill — port of V4 `.topnav .pill.active` (V4
 * line 95: solid indigo bg, white text). Reads the current pathname on
 * the client so the active highlight survives navigation. Non-active
 * pills match V4's default + hover styles (`.topnav .pill:hover` —
 * indigo-light bg, plain text).
 *
 * Split out into a client component so the layout itself stays a server
 * component (it awaits `listActiveCampaigns`).
 */
export function NavPill({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? "";
  // A pill matches when the URL starts with its href (so /tracker/<id>
  // still lights up the Tracker pill). Root "/" is handled specially.
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "inline-flex items-center rounded-[8px] bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white"
          : "inline-flex items-center rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium text-text-dim hover:bg-accent-light hover:text-text"
      }
    >
      {label}
    </Link>
  );
}
