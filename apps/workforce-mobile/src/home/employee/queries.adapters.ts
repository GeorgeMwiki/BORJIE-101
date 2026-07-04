/**
 * Pure fetchers + wire-row adapters for the employee-home hooks.
 *
 * The api-gateway mining surface answers every list route with the
 * canonical `{ success, data: rows }` envelope (see
 * `services/api-gateway/src/routes/mining/tasks.hono.ts` GET / —
 * `c.json({ success: true, data: rows })`). The hooks in `queries.ts`
 * previously unwrapped invented keys (`data.tasks`, `data.talk`,
 * `data.incidents`) that the gateway never sends, so every section
 * resolved `undefined` and React Query v5 rejected the query — the
 * worker inbox rendered an eternal loading line.
 *
 * These fetchers take the api client as a parameter so the contract
 * (path + query params + envelope unwrap + row adaptation) is testable
 * cold in the node vitest runner — same pattern as
 * `worker-hero-card.helpers.ts`.
 */

import type {
  AttendanceShift,
  AttendanceStatus,
  IncidentAlert,
  PerformanceSnapshotData,
  ShiftState,
  TaskPriority,
  TaskStatus,
  ToolboxTalk,
  WorkerTask
} from './types'

/** Canonical api-gateway success envelope for list routes. */
export interface ListEnvelope {
  readonly success?: boolean
  readonly data?: ReadonlyArray<Record<string, unknown>>
}

/** Canonical api-gateway success envelope for single-object routes. */
export interface ObjectEnvelope<T> {
  readonly success?: boolean
  readonly data?: T
}

/** Minimal slice of `miningApi` the fetchers need (injectable for tests). */
export interface MiningGetApi {
  readonly get: <T>(
    path: string,
    options?: {
      readonly query?: Readonly<Record<string, string | number | boolean | undefined>>
    }
  ) => Promise<T>
}

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function adaptPriority(v: unknown): TaskPriority {
  // Wire enum is low|normal|high|urgent (mining_tasks.priority); the
  // worker-home chip vocabulary is urgent|due|flex.
  if (v === 'urgent') return 'urgent'
  if (v === 'high') return 'due'
  return 'flex'
}

function adaptStatus(v: unknown): TaskStatus {
  // Wire enum is pending|in_progress|done|blocked|cancelled; `pending`
  // (and anything unknown) renders as `open` on the worker home.
  if (v === 'in_progress' || v === 'done' || v === 'blocked') return v
  return 'open'
}

/**
 * Adapt one camelCase Drizzle row (snake_case fallback for raw-SQL
 * projections) from GET /tasks into the WorkerTask render contract.
 * `sequence` is positional: the gateway orders by createdAt desc and
 * the row carries no numeric sequence column.
 */
export function adaptWorkerTask(
  row: Record<string, unknown>,
  index: number
): WorkerTask {
  // Keep each locale field independent: a missing EN value stays null so the
  // render layer shows a localized placeholder — NEVER the Swahili string
  // (cross-language fallback IS mixing; CLAUDE.md language-engineering rule 3).
  const titleSw = asNullableString(row.titleSw ?? row.title_sw)
  const titleEn = asNullableString(row.titleEn ?? row.title_en)
  const dueAtRaw = row.dueAt ?? row.due_at ?? null
  return {
    id: String(row.id ?? ''),
    titleSw,
    titleEn,
    priority: adaptPriority(row.priority),
    status: adaptStatus(row.status),
    dueAtIso: typeof dueAtRaw === 'string' ? dueAtRaw : null,
    locationLabelSw: null,
    locationLabelEn: null,
    sequence: index + 1,
    parallelGroupId: null
  }
}

export function adaptWorkerTasks(
  rows: ReadonlyArray<Record<string, unknown>>
): ReadonlyArray<WorkerTask> {
  return rows.map((row, index) => adaptWorkerTask(row, index))
}

/**
 * Adapt the first mining_toolbox_talks row (topicSw/topicEn) into the
 * ToolboxTalk card contract. Talks are pre-shift safety briefings —
 * always required. The list row carries no per-user ack timestamp
 * (acks live in toolbox-acks), so acknowledgedAtIso stays null.
 */
export function adaptToolboxTalk(
  rows: ReadonlyArray<Record<string, unknown>>
): ToolboxTalk | null {
  const row = rows[0]
  if (!row) return null
  // Independent locale fields — a missing EN topic stays null (placeholder at
  // render), never the Swahili topic. No cross-language fallback.
  return {
    id: String(row.id ?? ''),
    titleSw: asNullableString(row.topicSw ?? row.topic_sw),
    titleEn: asNullableString(row.topicEn ?? row.topic_en),
    required: true,
    acknowledgedAtIso: null
  }
}

function adaptSeverity(v: unknown): IncidentAlert['severity'] {
  // Wire enum is low|medium|high|critical; the 3-card alert UI folds
  // critical into high.
  if (v === 'critical' || v === 'high') return 'high'
  if (v === 'medium') return 'medium'
  return 'low'
}

/** Adapt one incidents row into the worker alert-card contract. */
export function adaptIncidentAlert(
  row: Record<string, unknown>
): IncidentAlert {
  const title =
    asNullableString(row.description) ?? String(row.kind ?? 'incident')
  const raisedAt = row.occurredAt ?? row.occurred_at ?? row.createdAt ?? null
  return {
    id: String(row.id ?? ''),
    severity: adaptSeverity(row.severity),
    titleSw: title,
    titleEn: title,
    raisedAtIso: typeof raisedAt === 'string' ? raisedAt : ''
  }
}

export function adaptIncidentAlerts(
  rows: ReadonlyArray<Record<string, unknown>>
): ReadonlyArray<IncidentAlert> {
  return rows.map((row) => adaptIncidentAlert(row))
}

/**
 * GET /tasks?assignedTo=<uuid>&status=open → WorkerTask[].
 * `status=open` is the gateway alias for pending|in_progress|blocked so
 * done/cancelled rows never reach the worker inbox.
 */
export async function fetchTodayTasks(
  api: MiningGetApi,
  userId: string
): Promise<ReadonlyArray<WorkerTask>> {
  const res = await api.get<ListEnvelope>('/tasks', {
    query: { assignedTo: userId, status: 'open' }
  })
  return adaptWorkerTasks(res?.data ?? [])
}

/** GET /toolbox-talks?date=today → first talk or null. */
export async function fetchToolboxTalk(
  api: MiningGetApi
): Promise<ToolboxTalk | null> {
  const res = await api.get<ListEnvelope>('/toolbox-talks', {
    query: { date: 'today' }
  })
  return adaptToolboxTalk(res?.data ?? [])
}

/** GET /incidents?status=open → active alert cards. */
export async function fetchActiveAlerts(
  api: MiningGetApi
): Promise<ReadonlyArray<IncidentAlert>> {
  const res = await api.get<ListEnvelope>('/incidents', {
    query: { status: 'open' }
  })
  return adaptIncidentAlerts(res?.data ?? [])
}

const SHIFT_STATES: ReadonlySet<string> = new Set([
  'not-started',
  'in-progress',
  'on-break',
  'ended'
])
const ATTENDANCE_STATUSES: ReadonlySet<string> = new Set([
  'present',
  'absent',
  'late',
  'unknown'
])

/**
 * Adapt the gateway AttendanceShift envelope into the hero contract. The
 * gateway already emits the render shape (state/status/elapsedSeconds from the
 * caller's real attendance row); this only unwraps `{ success, data }` and
 * clamps the discriminated unions, defaulting to an HONEST not-started shift
 * (never a fabricated running timer) when the field is absent/unknown.
 */
export function adaptMyShift(
  data: Record<string, unknown> | undefined
): AttendanceShift {
  const stateRaw = String(data?.state ?? '')
  const statusRaw = String(data?.status ?? '')
  const state: ShiftState = SHIFT_STATES.has(stateRaw)
    ? (stateRaw as ShiftState)
    : 'not-started'
  const status: AttendanceStatus = ATTENDANCE_STATUSES.has(statusRaw)
    ? (statusRaw as AttendanceStatus)
    : 'unknown'
  const elapsed = Number(data?.elapsedSeconds ?? 0)
  return {
    id: String(data?.id ?? ''),
    state,
    status,
    clockedInAtIso: asNullableString(data?.clockedInAtIso),
    siteName: asNullableString(data?.siteName),
    elapsedSeconds: Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed) : 0
  }
}

/** GET /attendance/mine → the caller's current/last shift. */
export async function fetchMyShift(api: MiningGetApi): Promise<AttendanceShift> {
  const res = await api.get<ObjectEnvelope<Record<string, unknown>>>(
    '/attendance/mine'
  )
  return adaptMyShift(res?.data)
}

/**
 * Adapt the gateway performance snapshot envelope. Both locale label/unit
 * fields are required (the gateway always emits sw+en), so a missing envelope
 * yields an honest zero-count snapshot rather than crashing the card.
 */
export function adaptPerformanceSnapshot(
  data: Record<string, unknown> | undefined
): PerformanceSnapshotData {
  const value = Number(data?.metricValue ?? 0)
  const delta = Number(data?.deltaPct ?? 0)
  const range = Number(data?.rangeDays ?? 7)
  return {
    metricLabelSw: String(data?.metricLabelSw ?? 'Zamu zilizofanyika'),
    metricLabelEn: String(data?.metricLabelEn ?? 'Shifts worked'),
    metricValue: Number.isFinite(value) ? value : 0,
    metricUnitSw: String(data?.metricUnitSw ?? 'zamu'),
    metricUnitEn: String(data?.metricUnitEn ?? 'shifts'),
    deltaPct: Number.isFinite(delta) ? delta : 0,
    rangeDays: Number.isFinite(range) && range > 0 ? range : 7
  }
}

/** GET /attendance/me/performance?range=7d → attendance-derived snapshot. */
export async function fetchPerformanceSnapshot(
  api: MiningGetApi,
  rangeDays: number
): Promise<PerformanceSnapshotData> {
  const res = await api.get<ObjectEnvelope<Record<string, unknown>>>(
    '/attendance/me/performance',
    { query: { range: `${rangeDays}d` } }
  )
  return adaptPerformanceSnapshot(res?.data)
}
