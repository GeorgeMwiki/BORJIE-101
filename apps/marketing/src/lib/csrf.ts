/**
 * CSRF header helper for BORJIE marketing site.
 *
 * Background
 * ----------
 * The api-gateway issues an `XSRF-TOKEN` cookie on session establishment
 * (see services/api-gateway/src/middleware/csrf.ts). Any state-changing
 * request from a browser-origin context (POST, PUT, PATCH, DELETE) must
 * echo that token in the `X-CSRF-Token` header so the gateway can
 * compare cookie ↔ header (double-submit pattern).
 *
 * The companion ESLint rule `borjie/require-csrf-headers` warns when a
 * client file makes a mutating `fetch(..., { method: 'POST' })` call
 * without importing this module (or the shared `@borjie/api-client`
 * wrapper, which threads CSRF via a request interceptor).
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
        return null;
      }
    }
  }
  return null;
}

export function getCsrfHeaders(): Record<string, string> {
  const token = readCsrfToken();
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}
