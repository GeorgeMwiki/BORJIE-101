/**
 * R39 — `useTodayShift` reads the supervisor's current shift schedule
 * and task list from `/api/v1/field/workforce/shifts/today`. Backs the
 * W-M-02 (worker shift-report) screen, replacing the hardcoded SHIFT
 * fixture with a live composition.
 *
 * Falls back to a deterministic empty-shift composition when the
 * endpoint is unavailable (network 0, 404, 501) so the FE still renders
 * a useful surface offline. Real errors propagate to the caller.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { request } from '../../api/client'
import { API_BASE_URL, FIELD_PREFIX } from '../../api/config'
import { ApiError } from '../../api/errors'

export interface ShiftTaskLite {
  readonly id: string
  readonly titleEn: string
  readonly titleSw: string
  readonly location: string | null
}

export interface TodayShift {
  readonly shiftDate: string
  readonly shiftKind: 'day' | 'night'
  readonly siteName: string
  readonly startISO: string
  readonly endISO: string
  readonly nextBreakISO: string | null
  readonly tasks: ReadonlyArray<ShiftTaskLite>
}

const TODAY_SHIFT_URL = `${API_BASE_URL}${FIELD_PREFIX}/shifts/today`

/**
 * Compose a deterministic empty-shift response so the screen still
 * renders when the gateway is unreachable. Anchored to today (TZ
 * +03:00) with a 06:00–18:00 day window and no tasks.
 */
function composeOfflineFallback(): TodayShift {
  const today = new Date().toISOString().slice(0, 10)
  return {
    shiftDate: today,
    shiftKind: 'day',
    siteName: '—',
    startISO: `${today}T06:00:00+03:00`,
    endISO: `${today}T18:00:00+03:00`,
    nextBreakISO: `${today}T10:00:00+03:00`,
    tasks: []
  }
}

function shouldFallback(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || error.status === 404 || error.status === 501
}

export function useTodayShift(): UseQueryResult<TodayShift, Error> {
  return useQuery<TodayShift, Error>({
    queryKey: ['field-workforce', 'shifts', 'today'],
    queryFn: async ({ signal }) => {
      try {
        return await request<TodayShift>(TODAY_SHIFT_URL, { signal })
      } catch (error) {
        if (shouldFallback(error)) {
          return composeOfflineFallback()
        }
        throw error
      }
    },
    staleTime: 5 * 60_000,
    retry: 1
  })
}

export { composeOfflineFallback }
