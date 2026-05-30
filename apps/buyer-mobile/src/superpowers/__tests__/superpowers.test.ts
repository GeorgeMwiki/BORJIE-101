import { describe, expect, it, vi } from 'vitest'

/**
 * Buyer-mobile superpowers unit test — navigate + share + bus cleanup.
 */

vi.mock('expo-router', () => ({
  router: { push: vi.fn() }
}))

vi.mock('expo-linking', () => ({
  openURL: vi.fn(async () => true)
}))

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(async () => ({ success: false }))
}))

vi.mock('react-native', () => ({
  Share: {
    share: vi.fn(async () => ({ action: 'sharedAction' })),
    dismissedAction: 'dismissedAction'
  }
}))

describe('buyer-mobile superpowers/navigate', () => {
  it('allows buyer-scoped routes', async () => {
    const mod = await import('../navigate')
    expect(mod.isBuyerAllowedRoute('/marketplace')).toBe(true)
    expect(mod.isBuyerAllowedRoute('/rfb/create')).toBe(true)
    expect(mod.isBuyerAllowedRoute('/bids/123')).toBe(true)
    expect(mod.isBuyerAllowedRoute('/chat')).toBe(true)
  })

  it('blocks owner / admin routes', async () => {
    const mod = await import('../navigate')
    expect(mod.isBuyerAllowedRoute('/(owner)/strategy')).toBe(false)
    expect(mod.isBuyerAllowedRoute('/admin/audit')).toBe(false)
  })

  it('publishes navigate request for allowed targets', async () => {
    const { navigateToTarget } = await import('../navigate')
    const { navigateRequestBus } = await import('../bus')
    const handler = vi.fn()
    const unsub = navigateRequestBus.subscribe(handler)
    navigateToTarget({ route: '/marketplace', label: 'Marketplace' })
    unsub()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('buyer-mobile superpowers/share', () => {
  it('falls back to a deterministic deep link when share-link API is offline', async () => {
    const { shareEntity } = await import('../share')
    const res = await shareEntity({ entityType: 'offer', entityId: 'offer-9', title: 'Bid 12 Mt' })
    expect(res.ok).toBe(true)
    expect(res.url).toContain('offer/offer-9')
  })
})
