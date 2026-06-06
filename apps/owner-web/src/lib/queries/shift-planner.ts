'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Owner-cockpit data hooks for the OSHA-TZ shift planner.
 *
 * Backed by `/api/v1/mining/shift-planner/*` (gateway route wrapping the
 * pure-compute `@borjie/mining-shift-planner` package):
 *   - useShiftRoster  → GET  /roster   (live employees / assets / sites)
 *   - useShiftPlan    → POST /plan     (solve a shift plan + OSHA report)
 *   - useFatigueScore → POST /fatigue  (score one worker's fatigue)
 *
 * LIVE-ONLY: no mock fallback. Failures land on the react-query error
 * channel; the surface renders an empty/error state.
 */

// ─── Shared planner shapes (mirror the package public types) ────────────

export type ShiftKind = 'morning' | 'afternoon' | 'night';

export type Certification =
  | 'haul-truck-license'
  | 'excavator-license'
  | 'underground-cert'
  | 'blaster-permit'
  | 'first-aid'
  | 'crusher-operator'
  | 'electrician-class-b'
  | 'confined-space';

export type EquipmentKind =
  | 'excavator'
  | 'haul-truck'
  | 'drill'
  | 'loader'
  | 'crusher'
  | 'grader'
  | 'lhd';

export type TaskZone =
  | 'surface-pit'
  | 'underground'
  | 'crusher'
  | 'processing-plant'
  | 'haulage-road'
  | 'maintenance-bay'
  | 'overburden';

export interface WorkShiftRecord {
  readonly shiftId: string;
  readonly startISO: string;
  readonly endISO: string;
  readonly zone: TaskZone;
}

export interface RosterWorker {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly certifications: ReadonlyArray<Certification>;
  readonly shiftPreferences: ReadonlyArray<ShiftKind>;
  readonly last72hShifts: ReadonlyArray<WorkShiftRecord>;
  readonly lastSafetyBriefingISO: string | null;
}

export interface RosterEquipment {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: EquipmentKind;
  readonly label: string;
  readonly availableFromISO: string;
  readonly availableToISO: string;
  readonly requiredCertification: Certification;
  readonly siteId: string | null;
}

export interface RosterSite {
  readonly id: string;
  readonly name: string;
  readonly mineral: string;
  readonly phase: string;
  readonly status: string;
}

export interface ShiftRoster {
  readonly workers: ReadonlyArray<RosterWorker>;
  readonly equipment: ReadonlyArray<RosterEquipment>;
  readonly sites: ReadonlyArray<RosterSite>;
  readonly counts: {
    readonly workers: number;
    readonly equipment: number;
    readonly sites: number;
  };
  readonly flags: ReadonlyArray<string>;
}

export interface ShiftTaskInput {
  readonly id: string;
  readonly zone: TaskZone;
  readonly requiredEquipment: ReadonlyArray<EquipmentKind>;
  readonly requiredCertifications: ReadonlyArray<Certification>;
  readonly estimatedHours: number;
}

export interface ShiftPlanRequest {
  readonly siteId: string;
  readonly shiftStartISO: string;
  readonly durationHours: number;
  readonly shiftKind: ShiftKind;
  readonly workers: ReadonlyArray<RosterWorker>;
  readonly equipment: ReadonlyArray<RosterEquipment>;
  readonly tasks: ReadonlyArray<ShiftTaskInput>;
  readonly ambientTemperatureC?: number;
}

export interface ShiftAssignment {
  readonly taskId: string;
  readonly workerId: string;
  readonly equipmentId: string;
  readonly zone: TaskZone;
  readonly startISO: string;
  readonly endISO: string;
  readonly fatigueAtAssignment: number;
}

export interface ShiftPlan {
  readonly tenantId: string;
  readonly siteId: string;
  readonly shiftStartISO: string;
  readonly shiftEndISO: string;
  readonly shiftKind: ShiftKind;
  readonly assignments: ReadonlyArray<ShiftAssignment>;
  readonly unassignedTasks: ReadonlyArray<{
    readonly taskId: string;
    readonly reason: string;
  }>;
  readonly rotationAlerts: ReadonlyArray<{
    readonly workerId: string;
    readonly atISO: string;
    readonly label: string;
  }>;
}

export interface OshaRuleResult {
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly pass: boolean;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly affectedWorkerIds: ReadonlyArray<string>;
  readonly detail: string;
}

export interface ComplianceReport {
  readonly tenantId: string;
  readonly siteId: string;
  readonly shiftStartISO: string;
  readonly pass: boolean;
  readonly results: ReadonlyArray<OshaRuleResult>;
  readonly blockingFailures: ReadonlyArray<string>;
}

export interface ShiftPlanResult {
  readonly plan: ShiftPlan;
  readonly compliance: ComplianceReport;
  readonly thresholds: Record<string, number>;
}

export interface FatigueScore {
  readonly workerId: string;
  readonly score: number;
  readonly hoursWorkedLast24h: number;
  readonly hoursWorkedLast72h: number;
  readonly consecutiveDays: number;
  readonly recommendedMaxHours: number;
  readonly factors: ReadonlyArray<{
    readonly label: string;
    readonly contribution: number;
  }>;
}

// ─── Query keys ─────────────────────────────────────────────────────────

export const shiftPlannerKeys = {
  roster: (siteId?: string) =>
    ['shift-planner', 'roster', siteId ?? 'all'] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────

/**
 * Live roster projection — REAL employees / assets / sites mapped into
 * planner-ready shapes. Drives the planner pre-fill + the headline KPIs.
 */
export function useShiftRoster(siteId?: string) {
  return useQuery({
    queryKey: shiftPlannerKeys.roster(siteId),
    queryFn: ({ signal }) => {
      const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
      return apiRequest<ShiftRoster>(
        `/api/v1/mining/shift-planner/roster${qs}`,
        { signal },
      );
    },
    staleTime: 60_000,
  });
}

/**
 * Solve a shift plan. Returns the plan + OSHA-TZ compliance report.
 * The gateway forces the request tenantId to the caller's tenant.
 */
export function useShiftPlan() {
  return useMutation({
    mutationFn: (request: ShiftPlanRequest) =>
      apiRequest<ShiftPlanResult>('/api/v1/mining/shift-planner/plan', {
        method: 'POST',
        body: request,
      }),
  });
}

/** Score a single worker's fatigue from a 72h shift log. */
export function useFatigueScore() {
  return useMutation({
    mutationFn: (args: {
      readonly workerId: string;
      readonly last72hShifts: ReadonlyArray<WorkShiftRecord>;
      readonly asOfISO?: string;
    }) =>
      apiRequest<{ readonly fatigue: FatigueScore }>(
        '/api/v1/mining/shift-planner/fatigue',
        { method: 'POST', body: args },
      ),
  });
}
