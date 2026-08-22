"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeskCrumbs } from "./DeskCrumbs";
import { DeskSearch } from "./DeskSearch";
import { DeskBodyClass } from "./DeskBodyClass";
import { MoreMenu } from "./MoreMenu";
import { OpusChatBar } from "./OpusChatBar";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

const PILLS = [
  { href: "/today", label: "Today", match: (p: string) => p === "/today" },
  {
    href: "/raise-calendar",
    label: "Calendar",
    match: (p: string) => p.startsWith("/raise-calendar"),
  },
  {
    href: "/call",
    label: "Current Call",
    match: (p: string) => p.startsWith("/call") || p.startsWith("/meeting"),
  },
  { href: "/chasers", label: "Chasers", match: (p: string) => p.startsWith("/chasers") },
];

export function RaiseDeskChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="raise-desk">
      <DeskBodyClass kind="desk" />
      <ServiceWorkerRegister />
      <header className="topbar">
        <Link href="/today" className="brand">
          <span className="dot" aria-hidden="true" />
          Forge Capital <span className="sub">Raise desk</span>
        </Link>
        <nav className="topnav">
          {PILLS.map((pill) => (
            <Link
              key={pill.label}
              href={pill.href}
              className={pill.match(pathname) ? "pill active" : "pill"}
            >
              {pill.label}
            </Link>
          ))}
        </nav>
        <MoreMenu />
        <DeskSearch />
      </header>
      <OpusChatBar docked />
      <Suspense fallback={null}>
        <DeskCrumbs />
      </Suspense>
      {children}
    </div>
  );
}
