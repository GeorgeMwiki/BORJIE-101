/**
 * Shared data contracts for the Manager role-home (W-M-02M).
 *
 * Wire-level spec: Docs/research/manager-dispatch-sota.md §9.
 *
 * Endpoints (api-gateway, prefix /api/v1/mining) are being built in parallel
 * by the B-Manager agent. When a path returns 404/501 the corresponding card
 * renders a PreviewBanner kind='env-missing' so the manager sees the missing
 * surface explicitly rather than fake data. React-query will auto-recover
 * the next time the endpoint resolves.
 */

import type { Lang } from '../../auth/types'

export type AlertSeverity = 'low' | 'med' | 'high'
export type SafetyStatus = 'green' | 'amber' | 'red'

export type ShiftKey = 'day' | 'night'

/**
 * Site Pulse wire contract (GET /api/v1/mining/cockpit). Nullable metrics have
 * NO real backend source and MUST render as a localized "—"/not-tracked tile —
 * never a fabricated number. See the gateway `site-pulse.ts` for provenance:
 *   planAttainmentPct        — null: no production TARGET feed exists.
 *   crewExpected             — null: no rostered-expected headcount source.
 *   equipmentAvailabilityPct — null: no equipment-availability table.
 *   crewOnShift              — null only when no site could be bound.
 * `shiftKey` is a locale-neutral key; the mobile layer localizes it (no prose
 * crosses the wire).
 */
export interface SitePulseData {
  readonly siteName: string | null
  readonly shiftKey: ShiftKey
  readonly planAttainmentPct: number | null
  readonly crewOnShift: number | null
  readonly crewExpected: number | null
  readonly equipmentAvailabilityPct: number | null
  readonly alertsCount: number
  readonly safetyStatus: SafetyStatus
}

export interface Incident {
  readonly id: string
  readonly title: string
  readonly severity: AlertSeverity
  readonly minutesOpen: number
  readonly actionLabel: 'escalate' | 'reassign' | 'inspect' | 'call'
}

export interface MaintenanceAlert {
  readonly id: string
  readonly assetId: string
  readonly assetLabel: string
  readonly healthStatus: 'warning' | 'critical'
  readonly note: string
}

export type CrewStatus = 'on_site' | 'late' | 'break' | 'absent' | 'off'

/**
 * Crew Roster row (GET /api/v1/mining/attendance/crew-roster). `fullName`,
 * `role` and `status` come from real employees + today's attendance. Nullable
 * fields have NO backing source and MUST NOT render a fabricated value:
 *   workloadPct     — null: no per-worker workload/utilization source.
 *   equipmentPaired — null: no worker↔equipment pairing table.
 */
export interface CrewMember {
  readonly id: string
  readonly fullName: string
  readonly role: string
  readonly status: CrewStatus
  readonly workloadPct: number | null
  readonly equipmentPaired: string | null
}

export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly site: string
  readonly priority: 'p1' | 'p2' | 'p3'
  readonly etaMinutes: number
}

export interface AssigneeSuggestion {
  readonly workerId: string
  readonly workerName: string
  readonly confidence: number
  readonly reason: string
  readonly evidenceId: string
}

export type ApprovalKind =
  | 'leave'
  | 'overtime'
  | 'shift_swap'
  | 'equipment_swap'
  | 'material_request'
  | 'incident_signoff'

export interface ApprovalRow {
  readonly id: string
  readonly kind: ApprovalKind
  readonly workerName: string
  readonly summary: string
  readonly receivedAt: string
  readonly aiHint: {
    readonly action: 'approve' | 'decline' | 'review'
    readonly confidence: number
    readonly evidenceId: string
  } | null
}

export interface PreviewState {
  readonly kind: 'env-missing'
  readonly missingPath: string
}

export interface MissingApiBag {
  readonly missing: ReadonlyArray<string>
  readonly markMissing: (path: string) => void
  readonly clearMissing: (path: string) => void
}

export type LocalizedCopy = Readonly<Record<Lang, string>>
