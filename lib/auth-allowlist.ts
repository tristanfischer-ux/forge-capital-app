/** Single address that may hold a session. Spec: not a client-only check. */
export const ALLOWED_SIGN_IN_EMAIL = "tristan.fischer@gmail.com";

export function isAllowedSignInEmail(
  email: string | null | undefined,
): boolean {
  return (email ?? "").trim().toLowerCase() === ALLOWED_SIGN_IN_EMAIL;
}
