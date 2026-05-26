/**
 * Platform-session helpers.
 *
 * The platform session cookie is a HQ-only, httpOnly token minted by
 * the identity service. This module exposes the canonical cookie name
 * so both middleware and route handlers reference a single constant.
 *
 * Follow-up identity-wiring (#33): validate the cookie value against the
 * identity service (`services/identity-service` → `/sessions/verify`)
 * and return the decoded `PlatformStaff` claim. The scaffold only
 * checks presence; presence alone is NOT authentication.
 */

export const PLATFORM_SESSION_COOKIE = 'borjie_platform_session';

export interface PlatformStaff {
  readonly id: string;
  readonly name: string;
  readonly roles: ReadonlyArray<string>;
}
