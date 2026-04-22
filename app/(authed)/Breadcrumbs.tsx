"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { resolveTrail, type BreadcrumbCrumb } from "@/lib/ui/breadcrumb-schema";

/**
 * Breadcrumbs — V4-token strip rendered in the authed shell, above the
 * walk-tour callout, below the topbar.
 *
 * Trail derivation: pathname → lib/ui/breadcrumb-schema.resolveTrail().
 * Dynamic segments (/investor/[id], /tracker/[id]/draft) default to a
 * generic label (or the raw segment). Pages can render
 * `<BreadcrumbsOverride label="Sequoia Capital" />` inside their body
 * to replace the final crumb's text with something human-readable (e.g.
 * the firm name fetched by the server component).
 *
 * Implementation notes:
 *   - Client component — uses usePathname() for live path tracking.
 *   - The override is wired through a React context. BreadcrumbsProvider
 *     must wrap Breadcrumbs AND the page content (we mount it in the
 *     authed layout). Pages set the override via useDynamicCrumbLabel().
 *   - If resolveTrail() returns an empty trail (unknown route), the
 *     strip renders nothing.
 *
 * See lib/ui/breadcrumb-schema.ts for the pathname → trail map.
 */

type DynamicCrumbsContextValue = {
  override: string | null;
  setOverride: (label: string | null) => void;
};

const DynamicCrumbsContext = createContext<DynamicCrumbsContextValue | null>(
  null,
);

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<string | null>(null);
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return (
    <DynamicCrumbsContext.Provider value={value}>
      {children}
    </DynamicCrumbsContext.Provider>
  );
}

/**
 * Page-level helper: mount `<BreadcrumbsOverride label="<pretty>" />`
 * inside any dynamic-route page to replace the default final crumb.
 * Renders nothing visible — it's a pure side-effect component.
 *
 * Example (app/(authed)/investor/[id]/page.tsx):
 *   <BreadcrumbsOverride label={profile.firm_name ?? "Unnamed firm"} />
 */
export function BreadcrumbsOverride({ label }: { label: string }) {
  const ctx = useContext(DynamicCrumbsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setOverride(label);
    return () => {
      ctx.setOverride(null);
    };
  }, [ctx, label]);
  return null;
}

/**
 * The breadcrumb strip itself. Mount once in the authed layout, above
 * the walk-tour callout.
 */
export function Breadcrumbs() {
  const pathname = usePathname() ?? "";
  const ctx = useContext(DynamicCrumbsContext);

  const trail = useMemo<BreadcrumbCrumb[]>(() => {
    const base = resolveTrail(pathname);
    if (base.length === 0) return base;

    // If a dynamic-page override is active, swap the final crumb's label.
    const override = ctx?.override ?? null;
    if (override) {
      const last = base[base.length - 1];
      return [...base.slice(0, -1), { ...last, label: override }];
    }
    return base;
  }, [pathname, ctx?.override]);

  if (trail.length === 0) return null;

  return (
    <nav className="bcrumbs" aria-label="Breadcrumb">
      {trail.map((crumb, idx) => {
        const isLast = idx === trail.length - 1;
        const sep =
          idx > 0 ? (
            <span className="bcrumbs-sep" aria-hidden="true">
              ·
            </span>
          ) : null;

        if (isLast || !crumb.href) {
          return (
            <span key={`${crumb.label}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {sep}
              <span className="bcrumbs-current" aria-current="page">
                {crumb.label}
              </span>
            </span>
          );
        }

        return (
          <span key={`${crumb.label}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {sep}
            <Link href={crumb.href}>{crumb.label}</Link>
          </span>
        );
      })}
    </nav>
  );
}
