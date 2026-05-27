/**
 * Typed wrappers around the buyer self-signup endpoints.
 *
 *   - POST /api/v1/buyers/signup                        — create buyer org
 *   - POST /api/v1/mining/buyers/kyc/atoms/:atomType    — upload one atom
 *
 * The KYC atom-upload route lives under /mining/buyers/ because it predates
 * this surface and the schema is shared with the workforce / admin consoles.
 * We don't recreate it here — just expose a typed wrapper.
 */

import { apiFetch } from '@/api/client'
import type { BuyerKycAtomKey, BuyerAccountKind } from './kyc-atoms'

export interface BuyerSignupResponse {
  readonly buyerOrgId: string
  readonly tenantId: string
  readonly userId: string
  readonly kind: BuyerAccountKind
  readonly kycAtoms: ReadonlyArray<BuyerKycAtomKey>
  readonly otpRequired: boolean
  readonly signupStatus: 'pending_otp_verification'
}

export async function submitBuyerSignup(
  body: Record<string, unknown>
): Promise<BuyerSignupResponse> {
  return apiFetch<BuyerSignupResponse>('/api/v1/buyers/signup', {
    method: 'POST',
    body
  })
}

export interface UploadAtomInput {
  readonly atomType: BuyerKycAtomKey
  readonly payload: Record<string, unknown>
}

export interface UploadAtomResponse {
  readonly success: true
  readonly data: {
    readonly id: string
    readonly atomType: BuyerKycAtomKey
    readonly status: string
  }
}

export async function uploadKycAtom(
  input: UploadAtomInput
): Promise<UploadAtomResponse> {
  return apiFetch<UploadAtomResponse>(
    `/api/v1/mining/buyers/kyc/atoms/${input.atomType}`,
    {
      method: 'POST',
      body: input.payload
    }
  )
}
