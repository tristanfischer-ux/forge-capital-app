"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeskCrumbs } from "./DeskCrumbs";
import { DeskSearch } from "./DeskSearch";
import { OpusChatBar } from "./OpusChatBar";

const PILLS = [
  { href: "/today", label: "Today", match: (p: string) => p === "/today" },
  { href: "/company", label: "Company", match: (p: string) => p.startsWith("/company") },
  { href: "/person", label: "Person", match: (p: string) => p.startsWith("/person") },
  { href: "/firm", label: "Firm", match: (p: string) => p.startsWith("/firm") },
  { href: "/raise-inbox", label: "Inbox", match: (p: string) => p.startsWith("/raise-inbox") },
  { href: "/raise-calendar", label: "Calendar", match: (p: string) => p.startsWith("/raise-calendar") || p.startsWith("/meeting") },
  { href: "/raise-excel", label: "Excel", match: (p: string) => p.startsWith("/raise-excel") },
  { href: "/desk-review", label: "Review", match: (p: string) => p.startsWith("/desk-review") },
];

export function RaiseDeskChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="raise-desk">
      <header className="topbar">
        <Link href="/today" className="brand">
          <span className="dot" aria-hidden="true" />
          Forge Capital <span className="sub">Raise desk</span>
        </Link>
        <nav className="topnav">
          {PILLS.map((pill) => (
            <Link
              key={pill.href}
              href={pill.href}
              className={pill.match(pathname) ? "pill active" : "pill"}
            >
              {pill.label}
            </Link>
          ))}
        </nav>
        <DeskSearch />
      </header>
      <OpusChatBar />
      <div className="live-banner">
        Live desk · real tracker rows · Excel is a download · nothing auto-sends
      </div>
      <Suspense fallback={null}>
        <DeskCrumbs />
      </Suspense>
      {children}
    </div>
  );
}
