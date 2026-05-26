import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { BuyerUser } from '@/types/auth'
import type { KycRecord, KycSubmission } from '@/types/kyc'

interface KycResponse {
  readonly data: KycRecord
}

export async function submitKyc(submission: KycSubmission): Promise<KycRecord> {
  const response = await apiFetch<KycResponse>(`${MINING_PREFIX}/buyers/kyc`, {
    method: 'POST',
    body: submission
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
    method: 'POST',
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

export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const response = await apiFetch<{ readonly data: NotificationPrefs }>(
    `${MINING_PREFIX}/buyers/profile/notifications`,
    {
      method: 'POST',
      body: prefs
    }
  )
  return response.data
}
