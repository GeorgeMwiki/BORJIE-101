/**
 * Employee-home data contract — what each of the 8 sections expects from the
 * api-gateway mining surface. Mirrors the wire spec in
 * `Docs/research/worker-guidance-sota.md` §9 and the R2 SOTA worker rules.
 *
 * All shapes are `readonly` per CLAUDE.md immutability rule — consume via
 * spreads, never mutate.
 */

export type ShiftState = 'not-started' | 'in-progress' | 'on-break' | 'ended'
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'unknown'
export type TaskPriority = 'urgent' | 'due' | 'flex'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'blocked'
export type IncidentSeverity = 'high' | 'medium' | 'low'

export interface AttendanceShift {
  readonly id: string
  readonly state: ShiftState
  readonly status: AttendanceStatus
  readonly clockedInAtIso: string | null
  readonly siteName: string | null
  readonly elapsedSeconds: number
}

export interface WorkerTask {
  readonly id: string
  readonly titleSw: string
  readonly titleEn: string
  readonly priority: TaskPriority
  readonly status: TaskStatus
  readonly dueAtIso: string | null
  readonly locationLabelSw: string | null
  readonly locationLabelEn: string | null
  readonly sequence: number
  readonly parallelGroupId: string | null
}

export interface PerformanceSnapshotData {
  readonly metricLabelSw: string
  readonly metricLabelEn: string
  readonly metricValue: number
  readonly metricUnitSw: string
  readonly metricUnitEn: string
  readonly deltaPct: number
  readonly rangeDays: number
}

export interface ToolboxTalk {
  readonly id: string
  readonly titleSw: string
  readonly titleEn: string
  readonly required: boolean
  readonly acknowledgedAtIso: string | null
}

export interface IncidentAlert {
  readonly id: string
  readonly severity: IncidentSeverity
  readonly titleSw: string
  readonly titleEn: string
  readonly raisedAtIso: string
}

export interface CoachSuggestion {
  readonly id: string
  readonly suggestionSw: string
  readonly suggestionEn: string
  readonly evidenceIds: ReadonlyArray<string>
}

/** Max alerts shown on home per worker-guidance §9 §4 (3-card limit). */
export const MAX_ALERTS = 3
/** R2 fat-thumb minimum tap target in dp (sunlight + gloves). */
export const MIN_TAP_DP = 56
/** R2 primary CTA size — bigger than 56 for the hero button. */
export const PRIMARY_CTA_DP = 64
