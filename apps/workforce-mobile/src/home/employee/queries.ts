/**
 * React-Query hooks that fetch the 6 employee-home surfaces from the
 * api-gateway mining surface. Each hook is independent: a single section
 * may surface env-missing without blocking the others (worker-guidance §9
 * behavioural rule — no fetch blocks render).
 *
 * Endpoint failures with `status === 0` (network) or `404` (route not
 * provisioned yet) bubble up so the section can render its env-missing /
 * no-data state. Other statuses surface as ApiError per `api/errors.ts`.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { miningApi } from '../../api/client'
import {
  fetchActiveAlerts,
  fetchTodayTasks,
  fetchToolboxTalk
} from './queries.adapters'
import type {
  AttendanceShift,
  CoachSuggestion,
  IncidentAlert,
  PerformanceSnapshotData,
  ToolboxTalk,
  WorkerTask
} from './types'

const STALE_60S = 60_000

export function useTodayShift(userId: string | null): UseQueryResult<AttendanceShift> {
  return useQuery<AttendanceShift>({
    queryKey: ['employee-home', 'attendance-mine', userId],
    enabled: Boolean(userId),
    staleTime: STALE_60S,
    queryFn: async () =>
      miningApi.get<AttendanceShift>('/attendance/mine')
  })
}

export function useTodayTasks(userId: string | null): UseQueryResult<ReadonlyArray<WorkerTask>> {
  return useQuery<ReadonlyArray<WorkerTask>>({
    queryKey: ['employee-home', 'tasks', userId],
    enabled: Boolean(userId),
    staleTime: STALE_60S,
    // GET /tasks answers the canonical { success, data: rows } envelope
    // (same unwrap as useManagerOpenTasks) — see queries.adapters.ts.
    queryFn: async () => fetchTodayTasks(miningApi, userId ?? '')
  })
}

export function useToolboxTalk(): UseQueryResult<ToolboxTalk | null> {
  return useQuery<ToolboxTalk | null>({
    queryKey: ['employee-home', 'toolbox-talks', 'today'],
    staleTime: STALE_60S,
    // GET /toolbox-talks answers { success, data: rows } — first row is
    // today's talk (route default-orders by scheduledFor desc).
    queryFn: async () => fetchToolboxTalk(miningApi)
  })
}

export function usePerformanceSnapshot(
  userId: string | null
): UseQueryResult<PerformanceSnapshotData> {
  return useQuery<PerformanceSnapshotData>({
    queryKey: ['employee-home', 'performance', userId],
    enabled: Boolean(userId),
    staleTime: STALE_60S,
    queryFn: async () =>
      miningApi.get<PerformanceSnapshotData>('/attendance/me/performance', {
        query: { range: '7d' }
      })
  })
}

export function useActiveAlerts(): UseQueryResult<ReadonlyArray<IncidentAlert>> {
  return useQuery<ReadonlyArray<IncidentAlert>>({
    queryKey: ['employee-home', 'incidents-open'],
    staleTime: STALE_60S,
    // GET /incidents answers { success, data: rows }. `status=open` is the
    // only "active" filter the route's query schema supports (the previous
    // `assignedToMe` param was never in the schema and was silently
    // stripped by zod).
    queryFn: async () => fetchActiveAlerts(miningApi)
  })
}

export function useNextStepCoach(userId: string | null): UseQueryResult<CoachSuggestion | null> {
  return useQuery<CoachSuggestion | null>({
    queryKey: ['employee-home', 'coach', userId],
    enabled: Boolean(userId),
    staleTime: STALE_60S,
    queryFn: async () => {
      const data = await miningApi.get<{ readonly suggestion: CoachSuggestion | null }>(
        '/copilots/worker-coach',
        { query: { userId: userId ?? '' } }
      )
      return data.suggestion
    }
  })
}
