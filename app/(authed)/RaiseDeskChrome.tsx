"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeskCrumbs } from "./DeskCrumbs";
import { DeskSearch } from "./DeskSearch";
import { DeskBodyClass } from "./DeskBodyClass";
import { MoreMenu } from "./MoreMenu";
import { OpusChatBar } from "./OpusChatBar";
import { ProgrammeChip } from "./ProgrammeChip";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";
import type { MandateCode } from "@/lib/capital/mandates";

const PILLS = [
  { href: "/today", label: "Today", match: (p: string) => p === "/today" },
  { href: "/send", label: "Send", match: (p: string) => p.startsWith("/send") },
  { href: "/chasers", label: "Chasers", match: (p: string) => p.startsWith("/chasers") },
  { href: "/notes", label: "Notes", match: (p: string) => p.startsWith("/notes") },
  { href: "/raise-inbox", label: "Inbox", match: (p: string) => p.startsWith("/raise-inbox") },
  {
    href: "/raise-calendar",
    label: "Calendar",
    match: (p: string) => p.startsWith("/raise-calendar") || p.startsWith("/meeting"),
  },
];

export function RaiseDeskChrome({
  children,
  programme,
}: {
  children: ReactNode;
  programme: MandateCode;
}) {
  const pathname = usePathname() ?? "";
  const sendHref = `/send/${programme}`;
  const chaserHref = `/chasers?code=${programme}`;
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
          {PILLS.map((pill) => {
            const href =
              pill.label === "Send" ? sendHref : pill.label === "Chasers" ? chaserHref : pill.href;
            return (
              <Link
                key={pill.label}
                href={href}
                className={pill.match(pathname) ? "pill active" : "pill"}
              >
                {pill.label}
              </Link>
            );
          })}
          <MoreMenu />
        </nav>
        <Suspense fallback={<span className="programme-chip">Programme</span>}>
          <ProgrammeChip initial={programme} />
        </Suspense>
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
