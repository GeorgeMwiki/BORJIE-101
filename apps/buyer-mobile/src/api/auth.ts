import { apiFetch } from './client'
import { withMockFallback } from './withFallback'
import { setAuthToken } from '@/auth/token'
import type { BuyerUser } from '@/types/auth'

export interface RequestOtpInput {
  readonly phone: string
}

export interface RequestOtpResult {
  readonly challengeId: string
  readonly expiresAt: string
}

export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: RequestOtpResult }>('/api/v1/auth/otp', {
        method: 'POST',
        body: input
      })
      return response.data
    },
    () => ({
      challengeId: `chall-mock-${Date.now()}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    })
  )
}

export interface VerifyOtpInput {
  readonly challengeId: string
  readonly code: string
  readonly phone: string
}

export interface VerifyOtpResult {
  readonly token: string
  readonly user: BuyerUser
}

export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const result = await withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: VerifyOtpResult }>('/api/v1/auth/verify', {
        method: 'POST',
        body: input
      })
      return response.data
    },
    (): VerifyOtpResult => ({
      token: `mock-jwt-${Date.now()}`,
      user: {
        id: 'buyer-001',
        role: 'buyer',
        companyName: 'Pamoja Refinery Ltd',
        countryCode: 'TZ',
        preferredLang: 'sw',
        kycStatus: 'submitted',
        phone: input.phone
      }
    })
  )
  await setAuthToken(result.token)
  return result
}
