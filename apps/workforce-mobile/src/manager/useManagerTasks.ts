/**
 * Manager task-queue hooks — commercial chain L4.
 *
 * Backs the manager dispatch screens in `app/(manager)/tasks/*`:
 *   - useManagerOpenTasks: live list of `mining_tasks` rows in the
 *     manager's tenant, optionally filtered by site/status. Drives the
 *     manager's "to dispatch" queue.
 *   - useAssignTaskToWorker: mutation hitting
 *     POST /api/v1/mining/tasks/:id/assign-worker which emits an
 *     audit-chain entry + (optionally) records the shift id on
 *     provenance.
 *
 * Each hook deals only with normalized snake_case rows the api-gateway
 * returns; renamers stay at the call site.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import { miningApi } from '../api/client'

export interface MiningTaskRow {
  readonly id: string
  readonly tenantId: string
  readonly siteId: string | null
  readonly assignedToUserId: string | null
  readonly assignedByUserId: string | null
  readonly titleSw: string
  readonly titleEn: string | null
  readonly descriptionSw: string | null
  readonly descriptionEn: string | null
  readonly priority: 'low' | 'normal' | 'high' | 'urgent'
  readonly status: 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled'
  readonly kind: 'standard' | 'rfb_fulfill' | 'inspection' | 'maintenance'
  readonly parentRfbId: string | null
  readonly dueAt: string | null
  readonly createdAt: string
}

interface ListTasksResponse {
  readonly success?: boolean
  readonly data?: ReadonlyArray<Record<string, unknown>>
}

function adaptTaskRow(r: Record<string, unknown>): MiningTaskRow {
  // The api-gateway returns Drizzle camelCase via /api/v1/mining/tasks
  // (uses miningTasks.$inferSelect). Fall back to snake_case for safety
  // since the SQL-projection paths (e.g. settlements list) use raw cols.
  const cast = <T extends string | null | undefined>(v: unknown): T =>
    (v ?? null) as T
  return {
    id: String(r.id ?? ''),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ''),
    siteId: cast<string | null>(r.siteId ?? r.site_id ?? null),
    assignedToUserId: cast<string | null>(
      r.assignedToUserId ?? r.assigned_to_user_id ?? null
    ),
    assignedByUserId: cast<string | null>(
      r.assignedByUserId ?? r.assigned_by_user_id ?? null
    ),
    titleSw: String(r.titleSw ?? r.title_sw ?? ''),
    titleEn: cast<string | null>(r.titleEn ?? r.title_en ?? null),
    descriptionSw: cast<string | null>(
      r.descriptionSw ?? r.description_sw ?? null
    ),
    descriptionEn: cast<string | null>(
      r.descriptionEn ?? r.description_en ?? null
    ),
    priority: (r.priority as MiningTaskRow['priority']) ?? 'normal',
    status: (r.status as MiningTaskRow['status']) ?? 'pending',
    kind: (r.kind as MiningTaskRow['kind']) ?? 'standard',
    parentRfbId: cast<string | null>(r.parentRfbId ?? r.parent_rfb_id ?? null),
    dueAt: cast<string | null>(r.dueAt ?? r.due_at ?? null),
    createdAt: String(r.createdAt ?? r.created_at ?? ''),
  }
}

export const managerTasksKeys = {
  open: (siteId?: string) => ['manager', 'tasks', 'open', siteId ?? 'all'] as const,
  detail: (id: string) => ['manager', 'tasks', 'detail', id] as const,
}

/**
 * Manager's open-task queue. Pulls /api/v1/mining/tasks?status=open
 * (the "open" alias covers pending | in_progress | blocked).
 */
export function useManagerOpenTasks(
  siteId?: string
): UseQueryResult<ReadonlyArray<MiningTaskRow>, Error> {
  return useQuery<ReadonlyArray<MiningTaskRow>, Error>({
    queryKey: managerTasksKeys.open(siteId),
    queryFn: async ({ signal }) => {
      const query: Record<string, string | number | undefined> = {
        status: 'open',
      }
      if (siteId) query.siteId = siteId
      const res = await miningApi.get<ListTasksResponse>('/tasks', {
        signal,
        query,
      })
      const rows = res.data ?? []
      return rows.map(adaptTaskRow)
    },
    staleTime: 15_000,
  })
}

export interface AssignTaskInput {
  readonly taskId: string
  readonly workerId: string
  readonly shiftId?: string
  readonly noteSw?: string
  readonly noteEn?: string
}

interface AssignResponse {
  readonly success?: boolean
  readonly data?: Record<string, unknown>
}

/**
 * Manager dispatch mutation. POSTs to /api/v1/mining/tasks/:id/assign-worker
 * which always appends a `mining.task.assign_worker` audit-chain entry.
 *
 * On success the manager open-task queue is invalidated so the row
 * either disappears (status moves out of `open`) or reflects the new
 * assignee inline.
 */
export function useAssignTaskToWorker(): UseMutationResult<
  MiningTaskRow,
  Error,
  AssignTaskInput,
  unknown
> {
  const queryClient = useQueryClient()
  return useMutation<MiningTaskRow, Error, AssignTaskInput, unknown>({
    mutationFn: async (input) => {
      const body: Record<string, unknown> = { workerId: input.workerId }
      if (input.shiftId) body.shiftId = input.shiftId
      if (input.noteSw) body.noteSw = input.noteSw
      if (input.noteEn) body.noteEn = input.noteEn
      const res = await miningApi.post<AssignResponse>(
        `/tasks/${encodeURIComponent(input.taskId)}/assign-worker`,
        body
      )
      if (!res.data) {
        throw new Error('Assign returned an empty payload')
      }
      return adaptTaskRow(res.data)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manager', 'tasks'] })
    },
  })
}
