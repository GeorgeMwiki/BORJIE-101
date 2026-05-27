import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

// `vi.hoisted` makes the spy available inside the hoisted vi.mock factory.
const { createClientSpy } = vi.hoisted(() => ({
  createClientSpy: vi.fn((url: string, key: string) => ({
    __url: url,
    __key: key,
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      signInWithOtp: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null }))
    }
  }))
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientSpy }))

import {
  getSupabaseClient,
  _resetSupabaseClientForTests
} from '../auth/supabaseClient'
import { parseSupabaseTokenForBuyer } from '../auth/buyerClaims'

describe('supabaseClient (buyer)', () => {
  beforeEach(() => {
    createClientSpy.mockClear()
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://buyer.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-buyer-key'
    _resetSupabaseClientForTests()
  })

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    _resetSupabaseClientForTests()
  })

  it('creates the client lazily', () => {
    expect(createClientSpy).not.toHaveBeenCalled()
    getSupabaseClient()
    expect(createClientSpy).toHaveBeenCalledTimes(1)
  })

  it('passes URL + anon key + mobile auth options to createClient', () => {
    getSupabaseClient()
    expect(createClientSpy).toHaveBeenCalledWith(
      'https://buyer.supabase.co',
      'anon-buyer-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        })
      })
    )
  })

  it('throws when env is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    _resetSupabaseClientForTests()
    expect(() => getSupabaseClient()).toThrow(/Supabase config missing/)
  })
})

describe('buyerClaims.parseSupabaseTokenForBuyer', () => {
  it('decodes tenant_id and phone from a real-shaped JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'buyer-uuid-1',
        phone: '+255712345678',
        app_metadata: { tenant_id: 'tenant-buyer-1' }
      })
    ).toString('base64url')
    const token = `${header}.${payload}.sig`
    const claims = parseSupabaseTokenForBuyer(token)
    expect(claims).not.toBeNull()
    expect(claims?.userId).toBe('buyer-uuid-1')
    expect(claims?.tenantId).toBe('tenant-buyer-1')
    expect(claims?.phone).toBe('+255712345678')
  })

  it('returns null for malformed input', () => {
    expect(parseSupabaseTokenForBuyer('')).toBeNull()
    expect(parseSupabaseTokenForBuyer('not-a-jwt')).toBeNull()
  })

  it('handles missing app_metadata gracefully', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url')
    const token = `${header}.${payload}.sig`
    const claims = parseSupabaseTokenForBuyer(token)
    expect(claims).not.toBeNull()
    expect(claims?.tenantId).toBeNull()
    expect(claims?.phone).toBeNull()
  })
})
