/**
 * Tests for the cookie-backed persona session store (admin-web).
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

describe('createCookiePersonaStore (admin)', () => {
  let jar: ReturnType<typeof installCookieJar>

  beforeEach(() => {
    jar = installCookieJar()
  })

  afterEach(() => {
    jar.restore()
  })

  it('round-trips a persona id through set then get', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.admin',
      maxAgeSeconds: 60
    })
    await store.setActive({ sessionId: 'admin-s1', personaId: 'persona-admin' })
    const result = await store.getActive({ sessionId: 'admin-s1' })
    expect(result).toBe('persona-admin')
  })

  it('emits samesite=lax, path=/, and the configured max-age', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.admin',
      maxAgeSeconds: 60 * 60 * 24 * 30
    })
    await store.setActive({ sessionId: 'admin-s2', personaId: 'p2' })
    const { lastWrite } = jar.read()
    expect(lastWrite).toContain('borjie.persona.admin=')
    expect(lastWrite).toContain('samesite=lax')
    expect(lastWrite).toContain('path=/')
    expect(lastWrite).toContain(`max-age=${60 * 60 * 24 * 30}`)
  })

  it('returns null before any cookie is set', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.empty',
      maxAgeSeconds: 60
    })
    expect(await store.getActive({ sessionId: 'x' })).toBeNull()
  })

  it('returns null when the sessionId no longer matches the cookie', async () => {
    const store = createCookiePersonaStore({
      cookieName: 'borjie.persona.admin',
      maxAgeSeconds: 60
    })
    await store.setActive({ sessionId: 'admin-old', personaId: 'persona-old' })
    expect(await store.getActive({ sessionId: 'admin-new' })).toBeNull()
  })
})
