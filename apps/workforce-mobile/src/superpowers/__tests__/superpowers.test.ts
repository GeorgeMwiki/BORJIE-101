import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * Workforce-mobile superpowers unit test — navigate + share.
 *
 * We exercise the persona guard on the navigate module (worker scope
 * blocks owner-only routes) and the share module's fallback link
 * builder so they ship hardened from day one. The bus is deliberately
 * exercised end-to-end so listener cleanup never regresses.
 */

// Stub expo-router so importing navigate.ts under vitest/node does not
// pull RN bridge code. expo-linking / Share are only touched inside
// share() so we mock them lazily inside the share test.
vi.mock('expo-router', () => ({
  router: { push: vi.fn() }
}))

vi.mock('expo-linking', () => ({
  openURL: vi.fn(async () => true)
}))

vi.mock('../../api/client', () => ({
  miningApi: {
    get: vi.fn(async () => ({ success: false })),
    post: vi.fn(async () => ({ success: false }))
  },
  ownerApi: {
    post: vi.fn(async () => ({
      success: true,
      data: { url: 'https://borjie.app/s/production_report/pr-123', token: 'tok-1' }
    }))
  }
}))

vi.mock('react-native', () => ({
  Share: {
    share: vi.fn(async () => ({ action: 'sharedAction' })),
    dismissedAction: 'dismissedAction'
  }
}))

describe('workforce-mobile superpowers/navigate', () => {
  it('allows worker-scoped routes', async () => {
    const mod = await import('../navigate')
    expect(mod.isWorkerAllowedRoute('/(worker)/tasks')).toBe(true)
    expect(mod.isWorkerAllowedRoute('/(tabs)')).toBe(true)
    expect(mod.isWorkerAllowedRoute('/photo-advisor')).toBe(true)
  })

  it('blocks owner/manager routes', async () => {
    const mod = await import('../navigate')
    expect(mod.isWorkerAllowedRoute('/(owner)/strategy')).toBe(false)
    expect(mod.isWorkerAllowedRoute('/(manager)/team')).toBe(false)
  })

  it('publishes a navigate request when a worker-allowed target fires', async () => {
    const { navigateToTarget } = await import('../navigate')
    const { navigateRequestBus } = await import('../bus')
    const handler = vi.fn()
    const unsub = navigateRequestBus.subscribe(handler)
    navigateToTarget({ route: '/(worker)/tasks', label: 'Tasks' })
    unsub()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]?.route).toBe('/(worker)/tasks')
  })

  it('drops a publish for a blocked route', async () => {
    const { navigateToTarget } = await import('../navigate')
    const { navigateRequestBus } = await import('../bus')
    const handler = vi.fn()
    const unsub = navigateRequestBus.subscribe(handler)
    navigateToTarget({ route: '/(owner)/secret', label: 'Nope' })
    unsub()
    expect(handler).not.toHaveBeenCalled()
  })

  // Regression guard (Mode-C): SearchFab default targets must (a) pass the
  // worker persona gate and (b) resolve to a real Expo route file. The
  // earlier `/(worker)/tasks` + `/(worker)/safety` targets 404'd because no
  // such screen existed under app/(worker)/.
  it('every default worker target is allowed and resolves to a real route', async () => {
    const { DEFAULT_WORKER_TARGETS, isWorkerAllowedRoute } = await import('../navigate')
    // Map a route string to candidate on-disk Expo route files.
    const appDir = resolve(__dirname, '../../../app')
    const routeExists = (route: string): boolean => {
      // Strip a leading slash; group segments like "(tabs)" are real dirs.
      const rel = route.replace(/^\//, '')
      const base = resolve(appDir, rel)
      return (
        existsSync(`${base}.tsx`) ||
        existsSync(resolve(base, 'index.tsx')) ||
        // Group-only route (e.g. "/(tabs)") resolves via its _layout.
        existsSync(resolve(base, '_layout.tsx'))
      )
    }
    for (const target of DEFAULT_WORKER_TARGETS) {
      expect(isWorkerAllowedRoute(target.route), `${target.route} not allowed`).toBe(true)
      expect(routeExists(target.route), `${target.route} missing on disk`).toBe(true)
    }
  })
})

describe('workforce-mobile superpowers/share', () => {
  it('returns ok + the server-minted url when the share-link API succeeds', async () => {
    const { shareEntity } = await import('../share')
    const res = await shareEntity({ entityType: 'production_report', entityId: 'pr-123', title: 'Repack pillar' })
    expect(res.ok).toBe(true)
    expect(res.url).toContain('production_report/pr-123')
  })
})
