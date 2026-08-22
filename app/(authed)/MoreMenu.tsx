"use client";

import Link from "next/link";

const ITEMS = [
  { href: "/discover", label: "Discover" },
  { href: "/verify-book", label: "Verify emails" },
  { href: "/sign-off", label: "Sign-off" },
  { href: "/collisions", label: "Collisions table" },
  { href: "/raise-excel", label: "Excel snapshot" },
  { href: "/log", label: "Quick log" },
  { href: "/notes", label: "Dump a transcript" },
];

export function MoreMenu() {
  return (
    <details className="more-menu">
      <summary className="pill">More</summary>
      <div className="more-panel">
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
