import { apiFetch } from './client'
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
  const response = await apiFetch<{ readonly data: RequestOtpResult }>('/api/v1/auth/otp', {
    method: 'POST',
    body: input
  })
  return response.data
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
  const response = await apiFetch<{ readonly data: VerifyOtpResult }>('/api/v1/auth/verify', {
    method: 'POST',
    body: input
  })
  await setAuthToken(response.data.token)
  return response.data
}
