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
})

describe('workforce-mobile superpowers/share', () => {
  it('returns ok + url even when the share-link API fails', async () => {
    const { shareEntity } = await import('../share')
    const res = await shareEntity({ entityType: 'task', entityId: 'task-123', title: 'Repack pillar' })
    expect(res.ok).toBe(true)
    expect(res.url).toContain('task/task-123')
  })
})
