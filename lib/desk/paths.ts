export const DESK_PREFIXES = [
  "/today",
  "/company",
  "/person",
  "/firm",
  "/discover",
  "/send",
  "/sign-off",
  "/chasers",
  "/notes",
  "/collisions",
  "/verify-book",
  "/raise-inbox",
  "/raise-calendar",
  "/raise-excel",
  "/desk-review",
  "/meeting",
  "/call",
  "/outreach",
  "/log",
] as const;

export function isRaiseDeskPath(pathname: string): boolean {
  return DESK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
