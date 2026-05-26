import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import { withMockFallback } from './withFallback'
import type { BuyerUser } from '@/types/auth'
import type { KycRecord, KycStage, KycSubmission } from '@/types/kyc'

interface KycResponse {
  readonly data: KycRecord
}

export async function submitKyc(submission: KycSubmission): Promise<KycRecord> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<KycResponse>(`${MINING_PREFIX}/buyers/kyc`, {
        method: 'POST',
        body: submission
      })
      return response.data
    },
    () => ({
      id: `kyc-local-${Date.now()}`,
      stage: 'submitted',
      updatedAt: new Date().toISOString(),
      rejectionReason: null
    })
  )
}

export async function fetchKycStatus(id: string): Promise<KycRecord> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<KycResponse>(
        `${MINING_PREFIX}/buyers/kyc/${encodeURIComponent(id)}/status`
      )
      return response.data
    },
    () => mockKycProgressing(id)
  )
}

// Walk through a deterministic progression so the verify screen visibly
// advances when the backend is unreachable.
let mockStageIndex = 0
const stageOrder: readonly KycStage[] = ['submitted', 'reviewing', 'reviewing', 'approved']

function mockKycProgressing(id: string): KycRecord {
  const stage = stageOrder[Math.min(mockStageIndex, stageOrder.length - 1)] ?? 'submitted'
  mockStageIndex = Math.min(mockStageIndex + 1, stageOrder.length - 1)
  return {
    id,
    stage,
    updatedAt: new Date().toISOString(),
    rejectionReason: null
  }
}

export interface ProfileUpdate {
  readonly companyName?: string
  readonly preferredLang?: 'sw' | 'en'
  readonly phone?: string
}

export async function updateProfile(input: ProfileUpdate): Promise<BuyerUser> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: BuyerUser }>(`${MINING_PREFIX}/buyers/profile`, {
        method: 'POST',
        body: input
      })
      return response.data
    },
    () => ({
      id: 'buyer-001',
      role: 'buyer',
      companyName: input.companyName ?? 'Pamoja Refinery Ltd',
      countryCode: 'TZ',
      preferredLang: input.preferredLang ?? 'sw',
      kycStatus: 'submitted',
      phone: input.phone ?? '+255 712 000 001'
    })
  )
}

export interface NotificationPrefs {
  readonly newListings: boolean
  readonly bidUpdates: boolean
  readonly documentReady: boolean
  readonly priceAlerts: boolean
}

export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: NotificationPrefs }>(
        `${MINING_PREFIX}/buyers/profile/notifications`,
        {
          method: 'POST',
          body: prefs
        }
      )
      return response.data
    },
    () => prefs
  )
}
