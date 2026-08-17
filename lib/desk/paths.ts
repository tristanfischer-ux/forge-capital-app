export const DESK_PREFIXES = [
  "/today",
  "/company",
  "/person",
  "/firm",
  "/raise-inbox",
  "/raise-calendar",
  "/raise-excel",
  "/desk-review",
] as const;

export function isRaiseDeskPath(pathname: string): boolean {
  return DESK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
