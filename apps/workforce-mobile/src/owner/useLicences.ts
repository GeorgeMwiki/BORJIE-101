import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { z } from 'zod'
import { miningApi, ownerApi } from '../api/client'
import { ApiError } from '../api/errors'
import type {
  Licence,
  LicenceBucket,
  LicenceRenewalResponse,
  LicencesResponse
} from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Pure: compute integer days from `now` until `expiresAt`. Negative when
 * already expired. Floor-rounded so the count ticks down once per
 * midnight relative to `now`.
 */
export function daysUntilExpiry(expiresAt: string, now: number = Date.now()): number {
  const target = Date.parse(expiresAt)
  if (!Number.isFinite(target)) {
    return Number.NaN
  }
  return Math.floor((target - now) / MS_PER_DAY)
}

/**
 * Pure: classify a days-to-expiry value into the four buckets. Caller
 * passes `daysLeft` from server OR a fresh `daysUntilExpiry(...)` call;
 * we deliberately accept the number so the function stays trivially
 * testable.
 */
export function classifyBucket(daysLeft: number): LicenceBucket {
  if (!Number.isFinite(daysLeft) || daysLeft < 0) {
    return 'expired'
  }
  if (daysLeft <= 7) {
    return 't7'
  }
  if (daysLeft <= 30) {
    return 't30'
  }
  return 't90'
}

const FALLBACK: LicencesResponse = {
  generatedAt: new Date().toISOString(),
  licences: [
    {
      id: 'l-12345',
      pmlNumber: 'PML 12345',
      siteName: 'Geita Pit 2',
      mineral: 'Gold',
      expiresOn: '2026-08-12',
      expiresAt: '2026-08-12T00:00:00Z',
      daysLeft: 79,
      bucket: 't90'
    },
    {
      id: 'l-67890',
      pmlNumber: 'PML 67890',
      siteName: 'Mwanza Block A',
      mineral: 'Gold',
      expiresOn: '2026-06-22',
      expiresAt: '2026-06-22T00:00:00Z',
      daysLeft: 28,
      bucket: 't30'
    },
    {
      id: 'l-24680',
      pmlNumber: 'PML 24680',
      siteName: 'Shinyanga East',
      mineral: 'Tanzanite',
      expiresOn: '2026-06-01',
      expiresAt: '2026-06-01T00:00:00Z',
      daysLeft: 7,
      bucket: 't7'
    }
  ]
}

/**
 * Owner licence calendar. Bucket + daysLeft are recomputed defensively
 * on the client from `expiresAt` (falling back to `expiresOn`) against
 * Date.now() so stale server values can never out-of-sync the UI.
 */
export function useLicences(): UseQueryResult<LicencesResponse, Error> {
  return useQuery<LicencesResponse, Error>({
    queryKey: ['mining', 'licences'],
    queryFn: async ({ signal }) => {
      try {
        const response = await ownerApi.get<LicencesResponse>('/mining/licences', {
          signal
        })
        return {
          ...response,
          licences: response.licences.map(reconcileLicence)
        }
      } catch (error) {
        if (error instanceof ApiError && (error.status === 0 || error.status === 404)) {
          return {
            ...FALLBACK,
            licences: FALLBACK.licences.map(reconcileLicence)
          }
        }
        throw error
      }
    },
    staleTime: 5 * 60_000
  })
}

function reconcileLicence(licence: Licence): Licence {
  const isoExpiry = licence.expiresAt ?? licence.expiresOn
  const computed = daysUntilExpiry(isoExpiry)
  const daysLeft = Number.isFinite(computed) ? computed : licence.daysLeft
  return {
    ...licence,
    daysLeft,
    bucket: classifyBucket(daysLeft)
  }
}

export function groupByBucket(
  licences: ReadonlyArray<Licence>
): Readonly<Record<LicenceBucket, ReadonlyArray<Licence>>> {
  const t7: Licence[] = []
  const t30: Licence[] = []
  const t90: Licence[] = []
  const expired: Licence[] = []
  for (const licence of licences) {
    if (licence.bucket === 't7') {
      t7.push(licence)
    } else if (licence.bucket === 't30') {
      t30.push(licence)
    } else if (licence.bucket === 't90') {
      t90.push(licence)
    } else {
      expired.push(licence)
    }
  }
  return { t7, t30, t90, expired }
}

const RenewalResponseSchema = z.object({
  renewalId: z.string().min(1),
  licenceId: z.string().min(1),
  status: z.enum(['queued', 'submitted', 'accepted']),
  submittedAt: z.string().min(1)
})

/**
 * Licence-renewal mutation. POSTs to the mining surface and invalidates
 * the licences query on success so the calendar refreshes.
 */
export function useRenewLicence(): UseMutationResult<
  LicenceRenewalResponse,
  Error,
  string
> {
  const queryClient = useQueryClient()
  return useMutation<LicenceRenewalResponse, Error, string>({
    mutationFn: async (licenceId: string) => {
      const response = await miningApi.post<unknown>(
        `/licences/${encodeURIComponent(licenceId)}/renew`,
        {}
      )
      const parsed = RenewalResponseSchema.safeParse(response)
      if (!parsed.success) {
        throw new Error('Renewal response failed schema validation')
      }
      return parsed.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mining', 'licences'] })
    }
  })
}
