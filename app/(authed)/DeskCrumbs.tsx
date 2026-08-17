"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function DeskCrumbs() {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const parts: { href: string; label: string }[] = [{ href: "/today", label: "Today" }];

  if (pathname.startsWith("/company")) {
    parts.push({ href: "/company", label: "Company (the raise)" });
  } else if (pathname.startsWith("/person")) {
    parts.push({ href: "/person", label: "People" });
    if (pathname !== "/person") parts.push({ href: pathname, label: "This person" });
  } else if (pathname.startsWith("/firm")) {
    parts.push({ href: "/firm", label: "Firms" });
    if (pathname !== "/firm") parts.push({ href: pathname, label: "This firm" });
  } else if (pathname.startsWith("/raise-inbox")) {
    parts.push({ href: "/raise-inbox", label: "Inbox" });
  } else if (pathname.startsWith("/raise-calendar")) {
    parts.push({ href: "/raise-calendar", label: "Calendar" });
  } else if (pathname.startsWith("/meeting")) {
    parts.push({ href: "/raise-calendar", label: "Calendar" });
    const bits = pathname.split("/").filter(Boolean);
    const meetingHref = bits[0] === "meeting" && bits[1] ? `/meeting/${bits[1]}` : pathname;
    parts.push({ href: meetingHref, label: "This meeting" });
    if (bits.includes("mail")) parts.push({ href: pathname, label: "This letter" });
  } else if (pathname.startsWith("/raise-excel")) {
    parts.push({ href: "/raise-excel", label: "Excel snapshot" });
  } else if (pathname.startsWith("/desk-review")) {
    parts.push({ href: "/desk-review", label: "Review queue" });
  } else if (pathname.startsWith("/log")) {
    parts.push({ href: "/log", label: "Quick log" });
  }

  const c = search.get("c");
  if (pathname.startsWith("/company") && c) {
    parts[parts.length - 1] = { href: `/company?c=${c}`, label: "This raise" };
  }

  return (
    <nav className="desk-crumbs" aria-label="You are here">
      {parts.map((p, i) => (
        <span key={`${p.href}-${i}`}>
          {i > 0 ? <span className="crumb-sep"> / </span> : null}
          {i === parts.length - 1 ? (
            <span>{p.label}</span>
          ) : (
            <Link href={p.href}>{p.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
