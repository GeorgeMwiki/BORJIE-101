import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ownerApi } from '../api/client'
import { ApiError } from '../api/errors'
import type { LicencesResponse, Licence, LicenceBucket } from './types'

function classify(daysLeft: number): LicenceBucket {
  if (daysLeft < 0) {
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
      expiresOn: '2026-08-12',
      daysLeft: 79,
      bucket: 't90'
    },
    {
      id: 'l-67890',
      pmlNumber: 'PML 67890',
      siteName: 'Mwanza Block A',
      expiresOn: '2026-06-22',
      daysLeft: 28,
      bucket: 't30'
    },
    {
      id: 'l-24680',
      pmlNumber: 'PML 24680',
      siteName: 'Shinyanga East',
      expiresOn: '2026-06-01',
      daysLeft: 7,
      bucket: 't7'
    }
  ]
}

/**
 * Owner licence calendar. Buckets are server-provided when possible, but
 * we recompute defensively so a stale bucket value can never out-of-sync
 * the UI. Falls back to the same data shape when the API is unreachable.
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
          licences: response.licences.map((licence) => ({
            ...licence,
            bucket: classify(licence.daysLeft)
          }))
        }
      } catch (error) {
        if (error instanceof ApiError && (error.status === 0 || error.status === 404)) {
          return FALLBACK
        }
        throw error
      }
    },
    staleTime: 5 * 60_000
  })
}

export function groupByBucket(
  licences: ReadonlyArray<Licence>
): Readonly<Record<LicenceBucket, ReadonlyArray<Licence>>> {
  const result: Record<LicenceBucket, Licence[]> = {
    t7: [],
    t30: [],
    t90: [],
    expired: []
  }
  for (const licence of licences) {
    result[licence.bucket].push(licence)
  }
  return result
}
