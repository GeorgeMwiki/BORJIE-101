/**
 * Tests for the cookie-backed persona session store (owner-web).
 *
 * Vitest is configured with `environment: 'jsdom'`, which gives us
 * a real `document.cookie` getter/setter that round-trips. We stub
 * it here for full inspection rather than relying on jsdom's
 * behaviour, so the tests are deterministic across vitest upgrades.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCookiePersonaStore } from '../persona-store'

interface CookieJar {
  readonly raw: string
  readonly lastWrite: string
}

function installCookieJar(): {
  read: () => CookieJar
  restore: () => void
} {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie'
  )
  let store = ''
  let lastWrite = ''
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() {
      return store
    },
    set(value: string) {
      lastWrite = value
      // crude jar: keep only `name=value` pairs, ignoring attribute flags.
      const head = value.split('; ')[0] ?? ''
      const [name] = head.split('=')
      if (!name) return
      const others = store
        .split('; ')
        .filter((p) => p && !p.startsWith(`${name}=`))
      const next = [head, ...others].filter((p) => p.length > 0).join('; ')
      store = next
    }
  })
  return {
    read: () => ({ raw: store, lastWrite }),
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(Document.prototype, 'cookie', originalDescriptor)
      }
    }
  }
}

describe('createCookiePersonaStore', () => {
  let jar: ReturnType<typeof installCookieJar>

  beforeEach(() => {
    jar = installCookieJar()
  })

  afterEach(() => {
    jar.restore()
  })

  it('round-trips a persona id through set then get', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.test',
      maxAgeSeconds: 60
    })
    await store.setActive({ sessionId: 'sess-1', personaId: 'persona-owner' })
    const result = await store.getActive({ sessionId: 'sess-1' })
    expect(result).toBe('persona-owner')
  })

  it('writes samesite=lax and namespaced cookie name', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.owner',
      maxAgeSeconds: 60
    })
    await store.setActive({ sessionId: 'sess-2', personaId: 'p2' })
    const { lastWrite } = jar.read()
    expect(lastWrite).toContain('borjie.persona.owner=')
    expect(lastWrite).toContain('samesite=lax')
    expect(lastWrite).toContain('path=/')
    expect(lastWrite).toContain('max-age=60')
  })

  it('returns null when no cookie has been written yet', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.absent',
      maxAgeSeconds: 60
    })
    const result = await store.getActive({ sessionId: 'sess-x' })
    expect(result).toBeNull()
  })

  it('returns null when sessionId does not match the stored binding', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.mismatch',
      maxAgeSeconds: 60
    })
    await store.setActive({ sessionId: 'sess-A', personaId: 'persona-A' })
    const result = await store.getActive({ sessionId: 'sess-B' })
    expect(result).toBeNull()
  })
})
