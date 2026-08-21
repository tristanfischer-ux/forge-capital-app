"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeskCrumbs } from "./DeskCrumbs";
import { DeskSearch } from "./DeskSearch";
import { OpusChatBar } from "./OpusChatBar";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

const PILLS = [
  { href: "/today", label: "Today", match: (p: string) => p === "/today" },
  { href: "/discover", label: "Discover", match: (p: string) => p.startsWith("/discover") || p.startsWith("/match") },
  { href: "/send", label: "Send", match: (p: string) => p.startsWith("/send") },
  { href: "/sign-off", label: "Sign-off", match: (p: string) => p.startsWith("/sign-off") },
  { href: "/collisions", label: "Collisions", match: (p: string) => p.startsWith("/collisions") },
  { href: "/raise-inbox", label: "Inbox", match: (p: string) => p.startsWith("/raise-inbox") },
  { href: "/raise-calendar", label: "Calendar", match: (p: string) => p.startsWith("/raise-calendar") || p.startsWith("/meeting") },
  { href: "/raise-excel", label: "Excel", match: (p: string) => p.startsWith("/raise-excel") },
  { href: "/log", label: "Log", match: (p: string) => p.startsWith("/log") },
];

export function RaiseDeskChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="raise-desk">
      <ServiceWorkerRegister />
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
