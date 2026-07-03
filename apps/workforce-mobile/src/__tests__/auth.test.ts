import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock expo-constants so supabaseClient.readConfig finds an `extra` object.
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))

// Mock expo-secure-store — no native bridge available in vitest.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

// Mock @supabase/supabase-js — we only verify that createClient is called
// with the expected URL + anon key. The full SDK is not exercised here.
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
import { parseSupabaseToken } from '../auth/jwtClaims'
import { AuthContext, buildStubUser } from '../auth/useAuth'
import {
  classifyOtpError,
  classifyOtpMessage,
  isOtpErrorCode
} from '../auth/otp-error'

describe('supabaseClient', () => {
  beforeEach(() => {
    createClientSpy.mockClear()
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
    _resetSupabaseClientForTests()
  })

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    _resetSupabaseClientForTests()
  })

  it('creates the client lazily on first access', () => {
    expect(createClientSpy).not.toHaveBeenCalled()
    const client = getSupabaseClient()
    expect(createClientSpy).toHaveBeenCalledTimes(1)
    expect(client).toBeTruthy()
  })

  it('reads supabase URL + anon key from env', () => {
    getSupabaseClient()
    expect(createClientSpy).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'anon-test-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        })
      })
    )
  })

  it('throws a descriptive error when env is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    _resetSupabaseClientForTests()
    expect(() => getSupabaseClient()).toThrow(/Supabase config missing/)
  })

  it('reuses the cached client on subsequent calls', () => {
    const a = getSupabaseClient()
    const b = getSupabaseClient()
    expect(a).toBe(b)
    expect(createClientSpy).toHaveBeenCalledTimes(1)
  })
})

describe('jwtClaims.parseSupabaseToken', () => {
  it('decodes app_metadata claims from a real-shaped JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-uuid-1',
        phone: '+255712345678',
        app_metadata: {
          tenant_id: 'tenant-acme',
          mining_role: 'site_manager',
          roles: ['site_manager']
        }
      })
    ).toString('base64url')
    const token = `${header}.${payload}.signature-not-checked`
    const claims = parseSupabaseToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.userId).toBe('user-uuid-1')
    expect(claims?.tenantId).toBe('tenant-acme')
    expect(claims?.role).toBe('manager')
    expect(claims?.phone).toBe('+255712345678')
  })

  it('returns null for a malformed token', () => {
    expect(parseSupabaseToken('')).toBeNull()
    expect(parseSupabaseToken('not.a.jwt.token.with.extra.parts')).toBeNull()
    expect(parseSupabaseToken('abc.def')).toBeNull()
  })

  it('maps owner / driver mining_role to the workforce Role union', () => {
    function build(miningRole: string): string {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'u1',
          app_metadata: { tenant_id: 't1', mining_role: miningRole }
        })
      ).toString('base64url')
      return `${header}.${payload}.sig`
    }
    expect(parseSupabaseToken(build('owner'))?.role).toBe('owner')
    expect(parseSupabaseToken(build('driver'))?.role).toBe('employee')
    expect(parseSupabaseToken(build('field_employee'))?.role).toBe('employee')
    expect(parseSupabaseToken(build('site_manager'))?.role).toBe('manager')
    expect(parseSupabaseToken(build('unknown_role'))?.role).toBeNull()
  })
})

describe('otp-error classifier', () => {
  it('maps rate-limit provider phrasings to rate_limited', () => {
    expect(classifyOtpMessage('Email rate limit exceeded')).toBe('rate_limited')
    expect(classifyOtpMessage('Too many requests')).toBe('rate_limited')
    expect(classifyOtpMessage('HTTP 429')).toBe('rate_limited')
  })

  it('maps expired phrasings to otp_expired', () => {
    expect(classifyOtpMessage('Token has expired')).toBe('otp_expired')
  })

  it('maps invalid/otp phrasings to otp_invalid', () => {
    expect(classifyOtpMessage('Invalid OTP')).toBe('otp_invalid')
    expect(classifyOtpMessage('Token is incorrect')).toBe('otp_invalid')
  })

  it('maps transport phrasings to network', () => {
    expect(classifyOtpMessage('Network request failed')).toBe('network')
    expect(classifyOtpMessage('fetch failed')).toBe('network')
  })

  it('falls back to send_failed for unknown shapes', () => {
    expect(classifyOtpMessage('some opaque provider text')).toBe('send_failed')
    expect(classifyOtpMessage('')).toBe('send_failed')
  })

  it('classifyOtpError handles Error, string, and unknown inputs', () => {
    expect(classifyOtpError(new Error('rate limit'))).toBe('rate_limited')
    expect(classifyOtpError('token has expired')).toBe('otp_expired')
    expect(classifyOtpError(null)).toBe('send_failed')
    expect(classifyOtpError({ weird: true })).toBe('send_failed')
  })

  it('isOtpErrorCode narrows only to known codes', () => {
    expect(isOtpErrorCode('otp_invalid')).toBe(true)
    expect(isOtpErrorCode('network')).toBe(true)
    expect(isOtpErrorCode('nope')).toBe(false)
    expect(isOtpErrorCode(42)).toBe(false)
  })
})

describe('useAuth context shape', () => {
  it('exports the extended context contract', () => {
    // AuthContext default value exposes the documented surface area.
    const ctx = AuthContext as unknown as {
      _currentValue: Record<string, unknown>
    }
    const value = ctx._currentValue
    expect(value).toBeDefined()
    expect(value.user).toBeNull()
    expect(value.ready).toBe(false)
    expect(typeof value.setRole).toBe('function')
    expect(typeof value.signOut).toBe('function')
    expect(typeof value.sendOtp).toBe('function')
    expect(typeof value.verifyOtp).toBe('function')
  })

  it('default sendOtp returns a stable code when AuthProvider is not mounted', async () => {
    const ctx = AuthContext as unknown as {
      _currentValue: { sendOtp: (p: string) => Promise<{ code?: string }> }
    }
    const res = await ctx._currentValue.sendOtp('+255712345678')
    // Never a raw provider string — a stable, provider-agnostic CODE the
    // screen maps to localized copy.
    expect(res.code).toBe('send_failed')
  })

  it('buildStubUser is still exported but flagged @deprecated', () => {
    expect(typeof buildStubUser).toBe('function')
    const stub = buildStubUser('owner')
    expect(stub.id).toMatch(/^dev-owner/)
    expect(stub.accessToken).toBe('')
    expect(stub.phoneE164).toBe('')
  })
})
