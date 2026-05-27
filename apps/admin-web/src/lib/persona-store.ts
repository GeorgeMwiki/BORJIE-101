/**
 * Persistent persona session store for admin-web.
 *
 * Backed by a browser cookie so that the active persona binding
 * survives full-page reload and tab restore. Without this, every
 * reload dropped the persona — a blocker for the live pilot.
 *
 * Why cookies, not localStorage:
 *  - Cookies are sent on the next API request, so the BFF can read
 *    the active persona during SSR-warmup endpoints.
 *  - localStorage is renderer-bound and unreadable from the server.
 *  - `samesite=lax` blocks cross-site CSRF on persona writes.
 *  - `secure` ensures cookies only travel over TLS in production.
 *
 * SSR contract: this adapter is BROWSER-ONLY. If you call setActive
 * or getActive during a React Server Component render or any Node
 * code path, the constructor returns successfully but every method
 * throws. The caller is expected to swap to a transient store (e.g.
 * `createInMemorySessionStore()`) when `typeof window === 'undefined'`.
 */
import type { ActivePersonaSessionStore } from '@borjie/persona-runtime'

export interface CookiePersonaStoreOptions {
  readonly cookieName: string
  readonly maxAgeSeconds: number
}

function assertBrowser(): void {
  if (typeof document === 'undefined') {
    throw new Error(
      'cookie persona store called during SSR — wrap with `typeof window` guard and fall back to createInMemorySessionStore()'
    )
  }
}

function buildCookie(args: {
  readonly name: string
  readonly value: string
  readonly maxAgeSeconds: number
}): string {
  const isHttps =
    typeof location !== 'undefined' && location.protocol === 'https:'
  const flags = [
    `${args.name}=${encodeURIComponent(args.value)}`,
    'path=/',
    `max-age=${args.maxAgeSeconds}`,
    'samesite=lax'
  ]
  if (isHttps) flags.push('secure')
  return flags.join('; ')
}

function readCookieValue(name: string): string | null {
  assertBrowser()
  const raw = document.cookie
  if (!raw) return null
  const parts = raw.split('; ')
  for (const part of parts) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx)
    if (key !== name) continue
    return decodeURIComponent(part.slice(idx + 1))
  }
  return null
}

export function createCookiePersonaStore(
  options: CookiePersonaStoreOptions
): ActivePersonaSessionStore {
  const { cookieName, maxAgeSeconds } = options
  return {
    async setActive({ sessionId, personaId }) {
      assertBrowser()
      const value = `${sessionId}:${personaId}`
      document.cookie = buildCookie({
        name: cookieName,
        value,
        maxAgeSeconds
      })
    },
    async getActive({ sessionId }) {
      const raw = readCookieValue(cookieName)
      if (!raw) return null
      const sepIdx = raw.indexOf(':')
      if (sepIdx < 0) return null
      const storedSessionId = raw.slice(0, sepIdx)
      const personaId = raw.slice(sepIdx + 1)
      if (storedSessionId !== sessionId) return null
      return personaId.length > 0 ? personaId : null
    }
  }
}
