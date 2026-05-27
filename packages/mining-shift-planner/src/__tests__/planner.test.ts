/**
 * Tests for `createMiningShiftPlanner`.
 *
 * Composes solver + fatigue + OSHA validator with injected ports:
 *   - assignmentSink (default in-memory)
 *   - oshaRulebook  (default in-memory, no overrides)
 *   - logger        (default NOOP)
 *
 * Throws:
 *   - FatigueExceededError on hard-cap pre-flight
 *   - OshaViolationError in strict mode if blocking failures exist
 *   - OverloadedScheduleError when nothing can be assigned
 */

import { describe, expect, it, vi } from 'vitest';

import {
  FatigueExceededError,
  OshaViolationError,
  OverloadedScheduleError,
} from '../errors.js';
import { createMiningShiftPlanner } from '../planner.js';
import {
  createInMemoryAssignmentSink,
  createInMemoryOshaRulebook,
  type AssignmentSinkPort,
  type OshaRulebookPort,
} from '../ports.js';
import {
  shiftRequestSchema,
  workerSchema,
  type Equipment,
  type ShiftRequest,
  type ShiftTask,
  type Worker,
  type WorkShiftRecord,
} from '../types.js';

const TENANT = 'tnt_alpha';
const SITE = 'site_geita';
const SHIFT_START = '2026-05-27T06:00:00Z';
const BRIEFING_FRESH = '2026-05-27T01:00:00Z';

function shift(
  startISO: string,
  endISO: string,
  zone: WorkShiftRecord['zone'] = 'surface-pit',
): WorkShiftRecord {
  return { shiftId: `shf_${startISO}`, startISO, endISO, zone };
}

function buildWorker(overrides: Partial<Worker> = {}): Worker {
  return workerSchema.parse({
    id: 'wrk_alpha',
    tenantId: TENANT,
    name: 'Asha M.',
    certifications: ['haul-truck-license'],
    shiftPreferences: ['morning'],
    last72hShifts: [],
    lastSafetyBriefingISO: BRIEFING_FRESH,
    ...overrides,
  });
}

function buildEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq_truck_01',
    tenantId: TENANT,
    kind: 'haul-truck',
    availableFromISO: '2026-05-27T00:00:00Z',
    availableToISO: '2026-05-28T00:00:00Z',
    requiredCertification: 'haul-truck-license',
    ...overrides,
  };
}

function buildTask(overrides: Partial<ShiftTask> = {}): ShiftTask {
  return {
    id: 'tsk_haul',
    zone: 'haulage-road',
    requiredEquipment: ['haul-truck'],
    requiredCertifications: ['haul-truck-license'],
    estimatedHours: 8,
    ...overrides,
  };
}

function buildRequest(overrides: Partial<ShiftRequest> = {}): ShiftRequest {
  return shiftRequestSchema.parse({
    tenantId: TENANT,
    siteId: SITE,
    shiftStartISO: SHIFT_START,
    durationHours: 8,
    shiftKind: 'morning',
    workers: [buildWorker()],
    equipment: [buildEquipment()],
    tasks: [buildTask()],
    ambientTemperatureC: 28,
    ...overrides,
  });
}

describe('createMiningShiftPlanner.planShift', () => {
  it('produces a plan and publishes assignments through the sink port', async () => {
    const sinkPublish = vi.fn(
      async (_args: { tenantId: string; siteId: string; assignments: ReadonlyArray<unknown> }) => ({
        publishedCount: 1,
      }),
    );
    const sink: AssignmentSinkPort = {
      publishAssignments: sinkPublish as never,
    };
    const planner = createMiningShiftPlanner({
      assignmentSink: sink,
      oshaRulebook: createInMemoryOshaRulebook(),
    });

    const plan = await planner.planShift(buildRequest());

    expect(plan.assignments).toHaveLength(1);
    expect(plan.unassignedTasks).toHaveLength(0);
    expect(sinkPublish).toHaveBeenCalledTimes(1);
    expect(sinkPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        siteId: SITE,
      }),
    );
  });

  it('throws FatigueExceededError when a worker is over the configured hard cap', async () => {
    // Maximally fatigued worker: 8 underground 12h-shifts back-to-back.
    const burnedOutShifts: WorkShiftRecord[] = [];
    for (let i = 0; i < 8; i++) {
      const d = String(19 + i).padStart(2, '0');
      burnedOutShifts.push(
        shift(`2026-05-${d}T00:00:00Z`, `2026-05-${d}T12:00:00Z`, 'underground'),
      );
    }
    const burnedWorker = buildWorker({
      id: 'wrk_burned',
      last72hShifts: burnedOutShifts,
    });
    const request = buildRequest({ workers: [burnedWorker] });

    // Aggressively low hard cap forces the pre-flight to trip.
    const planner = createMiningShiftPlanner({ fatigueHardCap: 0.1 });

    await expect(planner.planShift(request)).rejects.toBeInstanceOf(
      FatigueExceededError,
    );
  });

  it('throws OshaViolationError in strict mode when a blocking rule fails', async () => {
    // Worker without a safety briefing → R4 critical failure.
    const noBriefWorker = buildWorker({
      id: 'wrk_no_brief',
      lastSafetyBriefingISO: null,
    });
    const request = buildRequest({ workers: [noBriefWorker] });

    const planner = createMiningShiftPlanner({ strictOsha: true });

    await expect(planner.planShift(request)).rejects.toBeInstanceOf(
      OshaViolationError,
    );
  });

  it('throws OverloadedScheduleError when no task can be assigned at all', async () => {
    // Single task, cert nobody holds → 0 assignments → overloaded.
    const request = buildRequest({
      tasks: [
        buildTask({
          id: 'tsk_blast',
          requiredCertifications: ['blaster-permit'],
        }),
      ],
    });

    const planner = createMiningShiftPlanner();

    await expect(planner.planShift(request)).rejects.toBeInstanceOf(
      OverloadedScheduleError,
    );
  });

  it('honours OshaRulebookPort.fetchOverrides by relaxing the heat-stress threshold', async () => {
    // Hot day + single worker would normally trip R5 high.
    const request = buildRequest({
      ambientTemperatureC: 40,
      tasks: [
        buildTask({
          zone: 'surface-pit',
        }),
      ],
    });

    // Override threshold so 40 < relaxed → R5 passes.
    const rulebook: OshaRulebookPort = {
      async fetchOverrides() {
        return { heatStressTempC: 50 };
      },
    };
    const planner = createMiningShiftPlanner({
      oshaRulebook: rulebook,
      strictOsha: true,
    });

    // Should NOT throw — override neutralises R5.
    const plan = await planner.planShift(request);
    expect(plan.assignments).toHaveLength(1);
  });
});

describe('createMiningShiftPlanner.evaluateFatigue', () => {
  it('returns a FatigueScore for a worker id and a recent-shift array', async () => {
    const planner = createMiningShiftPlanner();

    const score = await planner.evaluateFatigue('wrk_eval', []);

    expect(score.workerId).toBe('wrk_eval');
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(1);
    expect(score.factors).toHaveLength(4);
  });

  it('rejects empty workerId with a clear error', async () => {
    const planner = createMiningShiftPlanner();

    await expect(planner.evaluateFatigue('', [])).rejects.toThrow(/workerId/);
  });
});

describe('createMiningShiftPlanner.validateOshaCompliance', () => {
  it('rebuilds the compliance report from the cached request after planShift', async () => {
    const planner = createMiningShiftPlanner();
    const request = buildRequest();

    const plan = await planner.planShift(request);
    const report = await planner.validateOshaCompliance(plan);

    expect(report.tenantId).toBe(TENANT);
    expect(report.siteId).toBe(SITE);
    expect(report.shiftStartISO).toBe(SHIFT_START);
    expect(report.results).toHaveLength(5);
    expect(report.pass).toBe(true);
    expect(report.blockingFailures).toEqual([]);
  });

  it('synthesizes a rotation-only report when no cached request exists for the plan', async () => {
    const planner = createMiningShiftPlanner();

    const syntheticPlan = {
      tenantId: 'tnt_unknown',
      siteId: 'site_unknown',
      shiftStartISO: SHIFT_START,
      shiftEndISO: '2026-05-27T14:00:00.000Z',
      shiftKind: 'morning' as const,
      assignments: [],
      unassignedTasks: [],
      rotationAlerts: [
        {
          workerId: 'wrk_x',
          atISO: '2026-05-27T10:00:00.000Z',
          label: 'Hazard rotation required',
        },
      ],
    };

    const report = await planner.validateOshaCompliance(syntheticPlan);

    expect(report.pass).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]!.ruleId).toBe('osha-tz-r3b');
    expect(report.results[0]!.affectedWorkerIds).toEqual(['wrk_x']);
    expect(report.blockingFailures).toEqual([]);
  });
});

describe('in-memory ports', () => {
  it('createInMemoryAssignmentSink buffers published assignments into the supplied array', async () => {
    const buffer: ReturnType<typeof Array> = [];
    const sink = createInMemoryAssignmentSink(buffer as never);

    const result = await sink.publishAssignments({
      tenantId: TENANT,
      siteId: SITE,
      assignments: [
        {
          taskId: 'tsk_haul',
          workerId: 'wrk_alpha',
          equipmentId: 'eq_truck_01',
          zone: 'haulage-road',
          startISO: SHIFT_START,
          endISO: '2026-05-27T14:00:00.000Z',
          fatigueAtAssignment: 0,
        },
      ],
    });

    expect(result.publishedCount).toBe(1);
    expect(buffer).toHaveLength(1);
  });

  it('createInMemoryOshaRulebook returns the constructor overrides verbatim', async () => {
    const rulebook = createInMemoryOshaRulebook({ minRestHours: 8 });

    const overrides = await rulebook.fetchOverrides({
      tenantId: TENANT,
      siteId: SITE,
    });

    expect(overrides).toEqual({ minRestHours: 8 });
  });
});
