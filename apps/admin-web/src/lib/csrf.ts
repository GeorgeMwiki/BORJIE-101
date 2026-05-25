/**
 * CSRF header helper for BORJIE admin-web.
 *
 * Background
 * ----------
 * The api-gateway issues an `X-CSRF-Token` cookie on session establishment
 * (see services/api-gateway/src/middleware/csrf.ts when wired). Any
 * state-changing request from a browser-origin context (POST, PUT, PATCH,
 * DELETE) must echo that token in the `X-CSRF-Token` header so the gateway
 * can compare cookie ↔ header (double-submit pattern).
 *
 * The companion ESLint rule `borjie/require-csrf-headers` warns when a
 * client file makes a mutating `fetch(..., { method: 'POST' })` call without
 * importing this module (or the shared @borjie/api-client wrapper, which
 * threads CSRF via a request interceptor).
 *
 * Usage
 * -----
 *   import { getCsrfHeaders } from '@/lib/csrf'
 *
 *   await fetch(url, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
 *     body: JSON.stringify(payload),
 *     credentials: 'include',
 *   })
 *
 * Server-side / SSR
 * -----------------
 * When invoked outside a browser (no `document`), this returns an empty
 * object — server-to-server calls authenticate with a bearer JWT and the
 * api-gateway exempts them from CSRF.
 */

const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Read the CSRF token from the document cookie jar.
 *
 * Returns the raw token string or `null` when:
 *   - we are not in a browser (no `document`),
 *   - no cookie of the configured name is present.
 *
 * Cookie values are URL-decoded; tokens are opaque base64url strings the
 * gateway generates with `crypto.randomBytes(32)`.
 */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx === -1) continue;
    const name = cookie.slice(0, eqIdx);
    if (name === CSRF_COOKIE_NAME) {
      const raw = cookie.slice(eqIdx + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        // Malformed cookie — treat as absent so the request fails closed.
        return null;
      }
    }
  }
  return null;
}

/**
 * Build a headers object containing the CSRF token, ready to spread into
 * `fetch()` `headers`. Returns `{}` when no token is available so callers
 * can unconditionally spread without conditional logic.
 *
 * Type matches the `HeadersInit` Record shape so TypeScript will infer it
 * correctly when spread alongside other header fields.
 */
export function getCsrfHeaders(): Record<string, string> {
  const token = readCsrfToken();
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}
