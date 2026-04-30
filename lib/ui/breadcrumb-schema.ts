/**
 * Breadcrumb trail schema — single source of truth for pathname →
 * breadcrumb labels. Every authed route that should show a trail is
 * declared here.
 *
 * Two-page architecture (2026-04-30):
 *   /discover — truth database (search + match)
 *   /pipeline — personal database (campaign-scoped outreach)
 *
 * Static routes map directly. Dynamic routes are declared with regex.
 * The last segment renders as a span (current page); earlier segments
 * as <Link>.
 */

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

export const STATIC_TRAILS: Record<string, BreadcrumbCrumb[]> = {
  "/discover": [{ label: "Discovery" }],
  "/pipeline": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline" }],
  "/home": [{ label: "Discovery" }],
  "/match": [{ label: "Discovery", href: "/discover" }, { label: "Find a Match" }],
  "/tracker": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Tracker" }],
  "/approval": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Approval" }],
  "/automation": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Automation" }],
  "/templates": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Templates" }],
  "/review": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Review" }],
  "/verification": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Verification" }],
  "/drafts": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Drafts" }],
  "/import": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Import tracker" }],
  "/weekly": [{ label: "Discovery", href: "/discover" }, { label: "My Pipeline", href: "/pipeline" }, { label: "Weekly update" }],
};

export type DynamicTrailMatcher = {
  match: RegExp;
  build: (groups: Record<string, string>) => BreadcrumbCrumb[];
};

export const DYNAMIC_TRAILS: DynamicTrailMatcher[] = [
  {
    match: /^\/investor\/(?<id>[^/]+)$/,
    build: ({ id }) => [
      { label: "Discovery", href: "/discover" },
      { label: "Find a Match", href: "/match" },
      { label: id },
    ],
  },
  {
    match: /^\/partner\/(?<id>[^/]+)$/,
    build: () => [
      { label: "Discovery", href: "/discover" },
      { label: "Find a Match", href: "/match" },
      { label: "Partner" },
    ],
  },
  {
    match: /^\/portfolio\/(?<slug>[^/]+)$/,
    build: () => [
      { label: "Discovery", href: "/discover" },
      { label: "Find a Match", href: "/match" },
      { label: "Company" },
    ],
  },
  {
    match: /^\/tracker\/(?<cpid>[^/]+)\/draft$/,
    build: () => [
      { label: "Discovery", href: "/discover" },
      { label: "My Pipeline", href: "/pipeline" },
      { label: "Tracker", href: "/tracker" },
      { label: "Draft email" },
    ],
  },
  {
    match: /^\/approval\/sheet\/(?<cid>[^/]+)$/,
    build: () => [
      { label: "Discovery", href: "/discover" },
      { label: "My Pipeline", href: "/pipeline" },
      { label: "Approval", href: "/approval" },
      { label: "Sheet" },
    ],
  },
  {
    match: /^\/graph\/(?<entity>[^/]+)\/(?<id>[^/]+)$/,
    build: () => [
      { label: "Discovery", href: "/discover" },
      { label: "Find a Match", href: "/match" },
      { label: "Graph" },
    ],
  },
];

export function resolveTrail(pathname: string): BreadcrumbCrumb[] {
  const normalised =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const staticHit = STATIC_TRAILS[normalised];
  if (staticHit) return staticHit;

  for (const { match, build } of DYNAMIC_TRAILS) {
    const m = normalised.match(match);
    if (m) {
      return build(m.groups ?? {});
    }
  }

  return [];
}
