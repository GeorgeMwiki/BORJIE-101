import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { BuyerUser } from '@/types/auth'
import type { KycRecord, KycSubmission } from '@/types/kyc'
import { toSubmitKycBody, type BuyerKind } from '@/kyc/toSubmitKycBody'

interface KycResponse {
  readonly data: KycRecord
}

/**
 * Submit buyer KYC. The wizard holds NESTED step state, but the gateway
 * `SubmitKycSchema` is FLAT — posting the nested shape straight through
 * 422'd and left onboarding dead. `toSubmitKycBody` is the single
 * translation point (see src/kyc/toSubmitKycBody.ts). `kind` defaults to
 * 'trader' until the wizard captures a buyer-kind step.
 */
export async function submitKyc(
  submission: KycSubmission,
  kind?: BuyerKind
): Promise<KycRecord> {
  const response = await apiFetch<KycResponse>(`${MINING_PREFIX}/buyers/kyc`, {
    method: 'POST',
    body: toSubmitKycBody(submission, kind)
  })
  return response.data
}

export async function fetchKycStatus(id: string): Promise<KycRecord> {
  const response = await apiFetch<KycResponse>(
    `${MINING_PREFIX}/buyers/kyc/${encodeURIComponent(id)}/status`
  )
  return response.data
}

export interface ProfileUpdate {
  readonly companyName?: string
  readonly preferredLang?: 'sw' | 'en'
  readonly phone?: string
}

export async function updateProfile(input: ProfileUpdate): Promise<BuyerUser> {
  const response = await apiFetch<{ readonly data: BuyerUser }>(`${MINING_PREFIX}/buyers/profile`, {
    method: 'PATCH',
    body: input
  })
  return response.data
}

export interface NotificationPrefs {
  readonly newListings: boolean
  readonly bidUpdates: boolean
  readonly documentReady: boolean
  readonly priceAlerts: boolean
}

export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const response = await apiFetch<{ readonly data: NotificationPrefs }>(
    `${MINING_PREFIX}/buyers/profile/notifications`
  )
  return response.data
}

export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const response = await apiFetch<{ readonly data: NotificationPrefs }>(
    `${MINING_PREFIX}/buyers/profile/notifications`,
    {
      method: 'PUT',
      body: prefs
    }
  )
  return response.data
}
