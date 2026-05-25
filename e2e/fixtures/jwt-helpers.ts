/**
 * JWT helpers for session-refresh / token-expiry E2E suite.
 *
 * Surfaced by `.audit/deep-audit-2026-05-20.md` as a launch blocker:
 * zero tests cover token-expiry / refresh-flow behaviour today. Users
 * who stay logged in for days hit this on day 1 of pilot.
 *
 * These helpers are deliberately small and side-effect free — they only
 * decode JWTs and forge tampered values; they never call the backend.
 * Specs decide where to inject the tampered token (cookie vs storage)
 * since the BORJIE stack persists auth state in BOTH locations
 * depending on the portal (owner = cookies, customer-app = localStorage).
 */
import type { BrowserContext, Page } from '@playwright/test';

// ============================================================================
// JWT DECODE / FORGE
// ============================================================================

export interface DecodedJwtPayload {
  readonly exp?: number;
  readonly iat?: number;
  readonly sub?: string;
  readonly tenant_id?: string;
  readonly [key: string]: unknown;
}

/**
 * Base64url decode that tolerates missing padding (RFC 7515 leaves the
 * trailing `=` chars optional). Browsers' atob() chokes on un-padded
 * input, so we re-pad first.
 */
function base64UrlDecode(input: string): string {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(standard, 'base64').toString('utf-8');
  }
  return atob(standard);
}

function base64UrlEncode(input: string): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(input, 'utf-8').toString('base64');
  } else {
    b64 = btoa(input);
  }
  return b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Decode the payload of a JWT (header.payload.signature) without verifying. */
export function decodeJwtPayload(jwt: string): DecodedJwtPayload | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as DecodedJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Forge a token whose payload claims `exp` is in the past. Signature is
 * preserved verbatim from the original — a correctly-implemented gateway
 * MUST reject because the signature no longer matches the tampered
 * payload, but the client's local exp-check should fire first and trigger
 * a refresh-token round-trip. That's the behaviour the suite asserts.
 */
export function forgeExpiredJwt(jwt: string, expEpochSecondsAgo = 60): string {
  const parts = jwt.split('.');
  if (parts.length !== 3) return jwt;
  const payload = decodeJwtPayload(jwt);
  if (!payload) return jwt;
  const tampered: DecodedJwtPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) - expEpochSecondsAgo,
  };
  const newPayloadB64 = base64UrlEncode(JSON.stringify(tampered));
  return `${parts[0]}.${newPayloadB64}.${parts[2]}`;
}

// ============================================================================
// CONTEXT MUTATION HELPERS
// ============================================================================

/**
 * Read a cookie value by name from the given context. Returns empty
 * string if absent. Designed for auth cookies whose names vary across
 * portals (`access_token`, `bn_access`, `__Host-session`).
 */
export async function getCookieValue(
  context: BrowserContext,
  candidateNames: readonly string[],
): Promise<{ name: string; value: string } | null> {
  const cookies = await context.cookies();
  for (const c of cookies) {
    if (candidateNames.includes(c.name) && c.value.length > 0) {
      return { name: c.name, value: c.value };
    }
  }
  return null;
}

/**
 * Replace an existing cookie's value while preserving domain/path/secure
 * flags. Used to swap in a tampered (expired) JWT mid-test.
 */
export async function replaceCookieValue(
  context: BrowserContext,
  cookieName: string,
  newValue: string,
): Promise<void> {
  const cookies = await context.cookies();
  const target = cookies.find((c) => c.name === cookieName);
  if (!target) return;
  await context.addCookies([{ ...target, value: newValue }]);
}

/**
 * Read any JWT-shaped value out of localStorage. Returns the first key
 * whose value parses as a 3-segment JWT. Used by customer-app where
 * tokens live in localStorage rather than cookies.
 */
export async function readJwtFromLocalStorage(
  page: Page,
): Promise<{ key: string; jwt: string } | null> {
  return await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const raw = window.localStorage.getItem(key) ?? '';
      // Match a bare JWT...
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) {
        return { key, jwt: raw };
      }
      // ...or a JSON-wrapped one (`{"token":"..."}`).
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const candidate =
          (parsed.token as string | undefined) ??
          (parsed.accessToken as string | undefined) ??
          (parsed.access_token as string | undefined);
        if (
          typeof candidate === 'string' &&
          /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(candidate)
        ) {
          return { key, jwt: candidate };
        }
      } catch {
        // not JSON — skip
      }
    }
    return null;
  });
}

export const AUTH_COOKIE_CANDIDATES = [
  'access_token',
  'accessToken',
  'bn_access',
  'session',
  '__Host-session',
  'auth_token',
] as const;

export const REFRESH_COOKIE_CANDIDATES = [
  'refresh_token',
  'refreshToken',
  'bn_refresh',
  '__Host-refresh',
] as const;
