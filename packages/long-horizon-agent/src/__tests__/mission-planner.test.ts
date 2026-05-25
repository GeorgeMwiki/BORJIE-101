import { describe, it, expect } from 'vitest';
import {
  normalisePlannedSteps,
  planMission,
  type MissionPlannerPort,
  type MissionRepositoryPort,
} from '../mission-planner.js';
import { type AgencyMission, type MissionStep, type PlannedStep } from '../types.js';
import { makeClock, makeIdGenerator, TENANT_A, USER_A, FROZEN_NOW_ISO } from './_fixtures.js';

describe('mission-planner — normalisePlannedSteps', () => {
  it('returns a single reflective step when decomposer returns nothing', () => {
    const result = normalisePlannedSteps([], 'Find lessee for Plot 27B');
    expect(result).toHaveLength(1);
    expect(result[0]!.stepKind).toBe('plan');
    expect(result[0]!.ordinal).toBe(0);
    expect(result[0]!.title).toContain('Find lessee for Plot 27B');
  });

  it('truncates over MAX_STEPS (32)', () => {
    const raw: PlannedStep[] = Array.from({ length: 64 }, (_, i) => ({
      ordinal: i,
      title: `Step ${i}`,
      description: null,
      stepKind: 'execute' as const,
      actionPlanId: null,
      scheduledFor: null,
    }));
    const result = normalisePlannedSteps(raw, 'Goal');
    expect(result).toHaveLength(32);
    expect(result[0]!.ordinal).toBe(0);
    expect(result[31]!.ordinal).toBe(31);
  });

  it('dedupes identical (kind, title) pairs', () => {
    const raw: PlannedStep[] = [
      { ordinal: 0, title: 'Send WhatsApp blast', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: null },
      { ordinal: 1, title: 'send whatsapp blast', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: null },
      { ordinal: 2, title: 'Sign lease', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: null },
    ];
    const result = normalisePlannedSteps(raw, 'Goal');
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Send WhatsApp blast');
    expect(result[1]!.title).toBe('Sign lease');
    // Re-numbered densely.
    expect(result[0]!.ordinal).toBe(0);
    expect(result[1]!.ordinal).toBe(1);
  });

  it('preserves caller-provided ordering by ordinal', () => {
    const raw: PlannedStep[] = [
      { ordinal: 5, title: 'Reflect', description: null, stepKind: 'reflect', actionPlanId: null, scheduledFor: null },
      { ordinal: 1, title: 'Gather', description: null, stepKind: 'gather', actionPlanId: null, scheduledFor: null },
      { ordinal: 3, title: 'Execute', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: null },
    ];
    const result = normalisePlannedSteps(raw, 'Goal');
    expect(result.map((s) => s.title)).toEqual(['Gather', 'Execute', 'Reflect']);
  });
});

describe('mission-planner — planMission end-to-end', () => {
  it('persists a mission + steps via the repository', async () => {
    const planner: MissionPlannerPort = {
      decompose: async () => [
        { ordinal: 0, title: 'Research market', description: null, stepKind: 'plan', actionPlanId: null, scheduledFor: null },
        { ordinal: 1, title: 'List on marketplace', description: null, stepKind: 'execute', actionPlanId: 'apl-001', scheduledFor: null },
        { ordinal: 2, title: 'Send WhatsApp blasts', description: null, stepKind: 'execute', actionPlanId: null, scheduledFor: null },
      ],
    };

    let capturedMission: Omit<AgencyMission, 'createdAt' | 'updatedAt'> | null = null;
    let capturedSteps: ReadonlyArray<Omit<MissionStep, 'createdAt'>> = [];

    const repository: MissionRepositoryPort = {
      async createMission(args) {
        capturedMission = args.mission;
        capturedSteps = args.steps;
        const mission: AgencyMission = {
          ...args.mission,
          createdAt: FROZEN_NOW_ISO,
          updatedAt: FROZEN_NOW_ISO,
        };
        const steps: MissionStep[] = args.steps.map((s) => ({
          ...s,
          createdAt: FROZEN_NOW_ISO,
        }));
        return { mission, steps };
      },
    };

    const ids = makeIdGenerator();
    const clock = makeClock();

    const result = await planMission(
      {
        tenantId: TENANT_A,
        assignedByUserId: USER_A,
        ownerPersonaId: null,
        title: 'Find lessee for Plot 27B',
        goal: 'Sign a lessee on Plot 27B by Nov 30',
        context: { parcelId: 'parc-001' },
        constraints: {
          expectedCompletionDate: '2026-11-30',
          riskTier: 'MEDIUM',
          autonomyTier: 'HITL_HIGH',
          budgetMinorUnits: 5_000_000,
          assetRefs: ['parc-001'],
        },
      },
      { planner, repository, ids, clock },
    );

    expect(result.mission.title).toBe('Find lessee for Plot 27B');
    expect(result.mission.status).toBe('planning');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]!.stepKind).toBe('plan');
    expect(result.steps[1]!.actionPlanId).toBe('apl-001');
    expect(capturedMission?.tenantId).toBe(TENANT_A);
    expect(capturedSteps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('falls back to a single reflective step when decomposer returns nothing', async () => {
    const planner: MissionPlannerPort = { decompose: async () => [] };
    const repository: MissionRepositoryPort = {
      async createMission(args) {
        return {
          mission: { ...args.mission, createdAt: FROZEN_NOW_ISO, updatedAt: FROZEN_NOW_ISO },
          steps: args.steps.map((s) => ({ ...s, createdAt: FROZEN_NOW_ISO })),
        };
      },
    };

    const result = await planMission(
      {
        tenantId: TENANT_A,
        assignedByUserId: USER_A,
        ownerPersonaId: null,
        title: 'Test',
        goal: 'Test goal',
        context: {},
        constraints: {
          expectedCompletionDate: null,
          riskTier: 'MEDIUM',
          autonomyTier: 'HITL_HIGH',
          budgetMinorUnits: null,
          assetRefs: [],
        },
      },
      { planner, repository, ids: makeIdGenerator(), clock: makeClock() },
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.stepKind).toBe('plan');
  });

  it('rejects invalid inputs at the boundary', async () => {
    const planner: MissionPlannerPort = { decompose: async () => [] };
    const repository: MissionRepositoryPort = {
      async createMission(args) {
        return {
          mission: { ...args.mission, createdAt: FROZEN_NOW_ISO, updatedAt: FROZEN_NOW_ISO },
          steps: args.steps.map((s) => ({ ...s, createdAt: FROZEN_NOW_ISO })),
        };
      },
    };
    await expect(
      planMission(
        // @ts-expect-error — missing required fields
        { tenantId: '', goal: '' },
        { planner, repository, ids: makeIdGenerator(), clock: makeClock() },
      ),
    ).rejects.toThrow();
  });
});
