"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  MANDATE_KIND,
  MANDATE_LABEL,
  MANDATE_OPTIONS,
  type MandateCode,
} from "@/lib/capital/mandates";
import { PROGRAMME_COOKIE } from "@/lib/desk/programme";

export function ProgrammeChip({ initial }: { initial: MandateCode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";

  function setCode(code: MandateCode) {
    document.cookie = `${PROGRAMME_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    if (pathname.startsWith("/send")) {
      router.push(`/send/${code}`);
      return;
    }
    if (pathname.startsWith("/chasers")) {
      router.push(`/chasers?code=${code}`);
      return;
    }
    if (pathname.startsWith("/sign-off")) {
      router.push(`/sign-off?code=${code}`);
      return;
    }
    router.refresh();
  }

  const customer = MANDATE_KIND[initial] === "customer";

  return (
    <label className={`programme-chip${customer ? " yu" : ""}`}>
      <span className="sr-only">Programme</span>
      <select
        value={initial}
        onChange={(e) => setCode(e.target.value as MandateCode)}
        aria-label="Active programme"
      >
        {MANDATE_OPTIONS.map((m) => (
          <option key={m.code} value={m.code}>
            {m.code} · {MANDATE_LABEL[m.code]}
            {MANDATE_KIND[m.code] === "customer" ? " · customers" : ""}
            {m.code === "HO" ? " · paused" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
