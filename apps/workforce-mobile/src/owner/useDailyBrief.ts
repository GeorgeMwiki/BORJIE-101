import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ownerApi } from '../api/client'
import { ApiError } from '../api/errors'
import type { DailyBriefResponse } from './types'

const EMPTY_BRIEF: DailyBriefResponse = {
  generatedAt: new Date(0).toISOString(),
  cards: []
}

/**
 * Owner daily brief query. NEVER fabricates KPIs: a 404 (no tenant brief
 * yet) resolves to an honest empty brief (zero cards) which the O-M-01
 * screen renders as its empty state. Any other failure (incl. network)
 * propagates so the screen shows its real error state. The previous
 * hardcoded fallback ("38 days runway", "Geita Pit 2 · pump failure") was
 * rendered as if real and has been removed.
 */
export function useDailyBrief(): UseQueryResult<DailyBriefResponse, Error> {
  return useQuery<DailyBriefResponse, Error>({
    queryKey: ['owner', 'daily-brief'],
    queryFn: async ({ signal }) => {
      try {
        return await ownerApi.get<DailyBriefResponse>('/cockpit/daily-brief', { signal })
      } catch (error) {
        // 404 = tenant has no brief yet → honest empty, not fabricated data.
        if (error instanceof ApiError && error.status === 404) {
          return EMPTY_BRIEF
        }
        throw error
      }
    },
    staleTime: 60_000
  })
}
