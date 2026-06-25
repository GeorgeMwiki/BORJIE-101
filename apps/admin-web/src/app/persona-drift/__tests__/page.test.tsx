/**
 * persona-drift/page.tsx — server-component smoke test.
 *
 * The page is an async server component: it awaits the locale cookie via
 * `readLocaleFromServerCookies` (which calls `next/headers` → `cookies()`)
 * before returning its JSX tree. Vitest runs outside a Next request scope,
 * so `cookies()` would throw / reject — we mock `next/headers` to supply a
 * deterministic cookie jar, then AWAIT the component so the read resolves
 * (no unhandled rejection). We assert the returned element tree is non-null
 * so build-time static-page generation has something to mount.
 */

import { describe, it, expect, vi } from 'vitest';

// Provide a request-scope cookie jar so the server-side locale read resolves.
// Empty jar → `readLocaleFromServerCookies` falls back to DEFAULT_LOCALE (en).
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (_name: string) => undefined,
    }),
}));

import PersonaDriftPage from '../page';

describe('Phase D D7 — persona-drift admin page', () => {
  it('returns a non-null JSX element', async () => {
    const element = await PersonaDriftPage();
    expect(element).not.toBeNull();
    expect(element).toBeDefined();
  });
});
