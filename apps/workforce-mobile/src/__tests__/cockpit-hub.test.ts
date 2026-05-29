/**
 * Tests for the owner-mobile cockpit hub hook (Roadmap R7).
 *
 * Vitest in workforce-mobile runs Node-only — we lock the pure-logic
 * helpers (`isEmptyCockpit`) and the fallback shape so the screen has
 * provable empty-state behaviour even before the api-gateway
 * `/cockpit/hub` endpoint lands.
 *
 * react-native + @tanstack/react-query are mocked at the module
 * boundary (per the existing dashboard.test.ts pattern) so the hook
 * module can import cleanly under Node-only vitest.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined,
  }),
}))
vi.mock('../api/client', () => ({
  ownerApi: { get: vi.fn(async () => ({})) },
}))
vi.mock('../api/errors', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))

describe('isEmptyCockpit', () => {
  it('returns true when generatedAt is epoch zero', async () => {
    const mod = await import('../owner/cockpit/useCockpitHub')
    expect(
      mod.isEmptyCockpit({
        brief: {
          headlineEn: '',
          headlineSw: '',
          generatedAt: new Date(0).toISOString(),
        },
        decisions: [],
        opportunities: [],
        risks: [],
        reminders: [],
        generatedAt: new Date(0).toISOString(),
      }),
    ).toBe(true)
  })

  it('returns false when generatedAt is a real timestamp', async () => {
    const mod = await import('../owner/cockpit/useCockpitHub')
    expect(
      mod.isEmptyCockpit({
        brief: {
          headlineEn: 'Cash is OK',
          headlineSw: 'Pesa ni sawa',
          generatedAt: '2026-05-29T12:00:00.000Z',
        },
        decisions: [],
        opportunities: [],
        risks: [],
        reminders: [],
        generatedAt: '2026-05-29T12:00:00.000Z',
      }),
    ).toBe(false)
  })
})
