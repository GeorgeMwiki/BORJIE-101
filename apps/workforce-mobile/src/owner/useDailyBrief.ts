import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ownerApi } from '../api/client'
import { ApiError } from '../api/errors'
import type { DailyBriefResponse } from './types'

const FALLBACK: DailyBriefResponse = {
  generatedAt: new Date().toISOString(),
  cards: [
    {
      id: 'cash',
      kind: 'cash_runway',
      title: 'Cash runway',
      value: '38 days',
      caption: 'Based on current burn'
    },
    {
      id: 'decisions',
      kind: 'open_decisions',
      title: 'Open decisions',
      value: '4',
      caption: '2 require fingerprint'
    },
    {
      id: 'blockers',
      kind: 'today_blockers',
      title: "Today's blockers",
      value: '3',
      caption: 'Geita Pit 2 · pump failure'
    }
  ]
}

/**
 * Owner daily brief query. Falls back to a deterministic stub when the API
 * is unreachable so the screen never shows empty in dev. We treat 404 the
 * same as network failure (no tenant data yet).
 */
export function useDailyBrief(): UseQueryResult<DailyBriefResponse, Error> {
  return useQuery<DailyBriefResponse, Error>({
    queryKey: ['owner', 'daily-brief'],
    queryFn: async ({ signal }) => {
      try {
        return await ownerApi.get<DailyBriefResponse>('/cockpit/daily-brief', { signal })
      } catch (error) {
        if (error instanceof ApiError && (error.status === 0 || error.status === 404)) {
          return FALLBACK
        }
        throw error
      }
    },
    staleTime: 60_000
  })
}
