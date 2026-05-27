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

export interface SitePulseData {
  readonly siteName: string
  readonly shiftLabel: string
  readonly planAttainmentPct: number
  readonly crewOnShift: number
  readonly crewExpected: number
  readonly equipmentAvailabilityPct: number
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

export interface CrewMember {
  readonly id: string
  readonly fullName: string
  readonly role: string
  readonly status: CrewStatus
  readonly statusDetail: string
  readonly workloadPct: number
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
