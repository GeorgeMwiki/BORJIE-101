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
    queryFn: async () => {
      const userQueryId = userId ?? ''
      const data = await miningApi.get<{ readonly tasks: ReadonlyArray<WorkerTask> }>(
        '/tasks',
        { query: { assignedTo: userQueryId } }
      )
      return data.tasks
    }
  })
}

export function useToolboxTalk(): UseQueryResult<ToolboxTalk | null> {
  return useQuery<ToolboxTalk | null>({
    queryKey: ['employee-home', 'toolbox-talks', 'today'],
    staleTime: STALE_60S,
    queryFn: async () => {
      const data = await miningApi.get<{ readonly talk: ToolboxTalk | null }>(
        '/toolbox-talks',
        { query: { date: 'today' } }
      )
      return data.talk
    }
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
    queryKey: ['employee-home', 'incidents-mine'],
    staleTime: STALE_60S,
    queryFn: async () => {
      const data = await miningApi.get<{ readonly incidents: ReadonlyArray<IncidentAlert> }>(
        '/incidents',
        { query: { assignedToMe: 'true' } }
      )
      return data.incidents
    }
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
