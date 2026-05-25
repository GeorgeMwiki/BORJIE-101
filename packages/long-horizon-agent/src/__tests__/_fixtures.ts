/**
 * Shared test fixtures + in-memory adapter implementations for the
 * long-horizon-agent package. Production wires real database adapters;
 * these stubs let the unit tests exercise every state machine without
 * a postgres dependency.
 */

import type {
  AgencyMission,
  AutonomyTier,
  MissionCheckpoint,
  MissionDriftEvent,
  MissionOutcome,
  MissionStep,
  OutcomeKind,
  RiskTier,
  StepKind,
} from '../types.js';

export const TENANT_A = 'tenant-a';
export const USER_A = 'user-a';

export const FROZEN_NOW_ISO = '2026-05-22T09:00:00.000Z';
export const FROZEN_TODAY = '2026-05-22';

export interface IdSequenceTracker {
  counts: Map<string, number>;
}

export function makeIdGenerator(): {
  nextId: (prefix: string) => string;
  state: IdSequenceTracker;
} {
  const state: IdSequenceTracker = { counts: new Map<string, number>() };
  return {
    state,
    nextId(prefix: string) {
      const n = (state.counts.get(prefix) ?? 0) + 1;
      state.counts.set(prefix, n);
      return `${prefix}-${n.toString().padStart(4, '0')}`;
    },
  };
}

export function makeClock(opts?: {
  nowIso?: string;
  todayIso?: string;
}): { nowIso: () => string; todayIso: () => string } {
  return {
    nowIso: () => opts?.nowIso ?? FROZEN_NOW_ISO,
    todayIso: () => opts?.todayIso ?? FROZEN_TODAY,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Mission / step / checkpoint / drift / outcome factory helpers.
// ─────────────────────────────────────────────────────────────────────────

export function makeMission(over: Partial<AgencyMission> = {}): AgencyMission {
  return {
    id: 'mis-0001',
    tenantId: TENANT_A,
    assignedByUserId: USER_A,
    ownerPersonaId: null,
    title: 'Find lessee for Plot 27B',
    goal: 'Sign a lessee on Plot 27B by Nov 30',
    contextJsonb: { parcelId: 'parc-001' },
    expectedCompletionDate: '2026-11-30',
    riskTier: 'MEDIUM' as RiskTier,
    autonomyTier: 'HITL_HIGH' as AutonomyTier,
    status: 'planning',
    budgetMinorUnits: 50_000_00,
    spentMinorUnits: 0,
    assetRefs: ['parc-001'],
    auditChainId: null,
    createdAt: FROZEN_NOW_ISO,
    updatedAt: FROZEN_NOW_ISO,
    completedAt: null,
    ...over,
  };
}

export function makeStep(over: Partial<MissionStep> = {}): MissionStep {
  return {
    id: 'mst-0001',
    tenantId: TENANT_A,
    missionId: 'mis-0001',
    ordinal: 0,
    title: 'Research market demand',
    description: null,
    stepKind: 'plan' as StepKind,
    actionPlanId: null,
    status: 'pending',
    scheduledFor: FROZEN_TODAY,
    attempts: 0,
    resultJsonb: null,
    startedAt: null,
    completedAt: null,
    createdAt: FROZEN_NOW_ISO,
    ...over,
  };
}

export function makeCheckpoint(
  over: Partial<MissionCheckpoint> = {},
): MissionCheckpoint {
  return {
    id: 'cpt-0001',
    tenantId: TENANT_A,
    missionId: 'mis-0001',
    checkpointKind: 'daily',
    scheduledAt: FROZEN_NOW_ISO,
    status: 'pending',
    summary: null,
    gapsJsonb: null,
    driftSignalsJsonb: null,
    needsHumanReview: false,
    reviewedAt: null,
    reviewedByUserId: null,
    createdAt: FROZEN_NOW_ISO,
    ...over,
  };
}

export function makeDrift(
  over: Partial<MissionDriftEvent> = {},
): MissionDriftEvent {
  return {
    id: 'drf-0001',
    tenantId: TENANT_A,
    missionId: 'mis-0001',
    driftKind: 'step_replan',
    description: 'Step stalled',
    beforeJsonb: null,
    afterJsonb: null,
    detectedBy: 'self',
    approvedByUserId: null,
    approvedAt: null,
    createdAt: FROZEN_NOW_ISO,
    ...over,
  };
}

export function makeOutcome(
  over: Partial<MissionOutcome> = {},
): MissionOutcome {
  return {
    id: 'mio-0001',
    tenantId: TENANT_A,
    missionId: 'mis-0001',
    outcomeKind: 'success' as OutcomeKind,
    narrative: 'Mission succeeded',
    metricsJsonb: {
      stepsCompleted: 0,
      stepsFailed: 0,
      stepsSkipped: 0,
      daysElapsed: 0,
      costMinorUnits: 0,
      replans: 0,
      escalations: 0,
    },
    lessonsLearnedJsonb: [],
    createdAt: FROZEN_NOW_ISO,
    ...over,
  };
}
