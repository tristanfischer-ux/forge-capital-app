/**
 * Breadcrumb trail schema — single source of truth for pathname →
 * breadcrumb labels. Every authed route that should show a trail is
 * declared here.
 *
 * Static routes map directly (e.g. `/match` → `["Home", "Find a Match"]`).
 * Dynamic routes are declared with the route pattern (e.g.
 * `/investor/[id]` → `["Home", "Find a Match", ":id"]`) — the `:id`
 * placeholder resolves to the actual URL segment by default, but dynamic
 * pages can override it with `<BreadcrumbsOverride label="..." />` to
 * show a prettier string (e.g. the firm name).
 *
 * Order of resolution in Breadcrumbs.tsx:
 *   1. Exact pathname match in STATIC_TRAILS.
 *   2. First matching regex in DYNAMIC_TRAILS (handles [id] segments).
 *   3. Fallback: single-segment trail from the pathname itself.
 */

export type BreadcrumbCrumb = {
  /** Visible label. */
  label: string;
  /** If set, the crumb renders as a <Link>; otherwise a span. Last segment never has href. */
  href?: string;
};

/**
 * Static pathname → trail. Final segment renders as a span (current page),
 * earlier segments render as <Link>.
 */
export const STATIC_TRAILS: Record<string, BreadcrumbCrumb[]> = {
  "/home": [{ label: "Home" }],
  "/match": [{ label: "Home", href: "/home" }, { label: "Find a Match" }],
  "/tracker": [{ label: "Home", href: "/home" }, { label: "Tracker" }],
  "/approval": [{ label: "Home", href: "/home" }, { label: "Approval" }],
  "/pipeline": [{ label: "Home", href: "/home" }, { label: "Pipeline" }],
  "/templates": [{ label: "Home", href: "/home" }, { label: "Templates" }],
  "/review": [{ label: "Home", href: "/home" }, { label: "Review" }],
  "/verification": [{ label: "Home", href: "/home" }, { label: "Verification" }],
  "/drafts": [{ label: "Home", href: "/home" }, { label: "Drafts" }],
  "/import": [{ label: "Home", href: "/home" }, { label: "Import tracker" }],
  "/weekly": [{ label: "Home", href: "/home" }, { label: "Weekly update" }],
};

/**
 * Dynamic-route trails. Each entry has a regex that matches the pathname
 * and a function producing the full trail from the matched groups. The
 * last segment's label is the default (raw segment value) — pages can
 * override via <BreadcrumbsOverride>.
 */
export type DynamicTrailMatcher = {
  match: RegExp;
  build: (groups: Record<string, string>) => BreadcrumbCrumb[];
};

export const DYNAMIC_TRAILS: DynamicTrailMatcher[] = [
  {
    // /investor/[id] → Home · Find a Match · <id>
    match: /^\/investor\/(?<id>[^/]+)$/,
    build: ({ id }) => [
      { label: "Home", href: "/home" },
      { label: "Find a Match", href: "/match" },
      { label: id },
    ],
  },
  {
    // /partner/[id] → Home · Find a Match · Partner
    // Rarely reached directly; the usual pathway is match → investor
    // profile → partner. Default label is "Partner"; pages override
    // via <BreadcrumbsOverride> with the partner's real name.
    match: /^\/partner\/(?<id>[^/]+)$/,
    build: () => [
      { label: "Home", href: "/home" },
      { label: "Find a Match", href: "/match" },
      { label: "Partner" },
    ],
  },
  {
    // /tracker/[campaignPartnerId]/draft → Home · Tracker · Draft email
    match: /^\/tracker\/(?<cpid>[^/]+)\/draft$/,
    build: () => [
      { label: "Home", href: "/home" },
      { label: "Tracker", href: "/tracker" },
      { label: "Draft email" },
    ],
  },
  {
    // /approval/sheet/[campaignId] → Home · Approval · Sheet
    match: /^\/approval\/sheet\/(?<cid>[^/]+)$/,
    build: () => [
      { label: "Home", href: "/home" },
      { label: "Approval", href: "/approval" },
      { label: "Sheet" },
    ],
  },
];

/**
 * Resolve a pathname to a breadcrumb trail. Returns an empty array if the
 * pathname isn't recognised — Breadcrumbs then renders nothing, which is
 * the right outcome for unknown routes (root `/`, auth callbacks, etc.).
 */
export function resolveTrail(pathname: string): BreadcrumbCrumb[] {
  // Strip a trailing slash (except for bare "/") so "/match/" and "/match"
  // collapse to the same entry.
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
