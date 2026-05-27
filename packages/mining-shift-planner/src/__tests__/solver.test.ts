/**
 * Tests for `solveShiftPlan`.
 *
 * Greedy solver:
 *   1. Sort tasks by required-cert count descending.
 *   2. Pick worker with lowest fatigue holding all required certs and
 *      with recommendedMaxHours >= shift duration.
 *   3. Pick first available equipment matching kind + worker certs.
 *   4. Flag hazard-zone rotation alerts for underground / surface-pit.
 */

import { describe, expect, it } from 'vitest';

import { solveShiftPlan } from '../solver.js';
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

describe('solveShiftPlan', () => {
  it('assigns a worker + equipment for a task when all constraints align', () => {
    const request = buildRequest();

    const plan = solveShiftPlan(request);

    expect(plan.tenantId).toBe(TENANT);
    expect(plan.siteId).toBe(SITE);
    expect(plan.shiftStartISO).toBe(SHIFT_START);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.unassignedTasks).toHaveLength(0);
    expect(plan.assignments[0]!.taskId).toBe('tsk_haul');
    expect(plan.assignments[0]!.workerId).toBe('wrk_alpha');
    expect(plan.assignments[0]!.equipmentId).toBe('eq_truck_01');
    expect(plan.assignments[0]!.fatigueAtAssignment).toBe(0);
  });

  it('leaves a task unassigned with a cert-mismatch reason when no worker holds the required cert', () => {
    const request = buildRequest({
      tasks: [
        buildTask({
          requiredCertifications: ['blaster-permit'],
        }),
      ],
    });

    const plan = solveShiftPlan(request);

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassignedTasks).toHaveLength(1);
    expect(plan.unassignedTasks[0]!.reason).toMatch(/certifications/i);
    expect(plan.unassignedTasks[0]!.reason).toContain('blaster-permit');
  });

  it('leaves a task unassigned with an equipment-mismatch reason when no equipment fits', () => {
    const request = buildRequest({
      tasks: [
        buildTask({
          requiredEquipment: ['excavator'],
        }),
      ],
    });

    const plan = solveShiftPlan(request);

    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassignedTasks).toHaveLength(1);
    expect(plan.unassignedTasks[0]!.reason).toMatch(/equipment/i);
    expect(plan.unassignedTasks[0]!.reason).toContain('excavator');
  });

  it('skips a fatigued worker whose recommendedMaxHours falls below the shift duration', () => {
    // Stack last72h hours high to push score → recommendedMaxHours
    // shrinks below the 8h shift.
    const heavyShifts: WorkShiftRecord[] = [];
    for (let i = 0; i < 8; i++) {
      const d = String(19 + i).padStart(2, '0');
      heavyShifts.push(
        shift(`2026-05-${d}T00:00:00Z`, `2026-05-${d}T12:00:00Z`, 'underground'),
      );
    }
    const fatiguedWorker = buildWorker({
      id: 'wrk_fatigued',
      last72hShifts: heavyShifts,
    });
    const request = buildRequest({
      workers: [fatiguedWorker],
    });

    const plan = solveShiftPlan(request);

    // Worker eligible by cert but blocked by fatigue cap. Falls
    // through to the "everyone already assigned" branch.
    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassignedTasks).toHaveLength(1);
    expect(plan.unassignedTasks[0]!.reason).toMatch(/already assigned/i);
  });

  it('emits a hazard-zone rotation alert for an underground task longer than the rotation window', () => {
    const ugWorker = buildWorker({
      id: 'wrk_ug',
      certifications: ['underground-cert', 'haul-truck-license'],
    });
    const ugEquipment = buildEquipment({
      id: 'eq_lhd_01',
      kind: 'lhd',
      requiredCertification: 'underground-cert',
    });
    const ugTask = buildTask({
      id: 'tsk_ug',
      zone: 'underground',
      requiredEquipment: ['lhd'],
      requiredCertifications: ['underground-cert'],
      estimatedHours: 8,
    });
    const request = buildRequest({
      workers: [ugWorker],
      equipment: [ugEquipment],
      tasks: [ugTask],
      durationHours: 8, // > default hazardRotationHours of 4.
    });

    const plan = solveShiftPlan(request);

    expect(plan.assignments).toHaveLength(1);
    expect(plan.rotationAlerts).toHaveLength(1);
    expect(plan.rotationAlerts[0]!.workerId).toBe('wrk_ug');
    expect(plan.rotationAlerts[0]!.label).toMatch(/underground/);
    // Rotation alert timestamp = shiftStart + 4h.
    expect(plan.rotationAlerts[0]!.atISO).toBe('2026-05-27T10:00:00.000Z');
  });

  it('prefers the worker with the lower fatigue score when multiple are eligible', () => {
    const freshWorker = buildWorker({ id: 'wrk_fresh' });
    const tiredWorker = buildWorker({
      id: 'wrk_tired',
      last72hShifts: [
        // 6h ending 4h before AS_OF — bumps last24h contribution.
        shift('2026-05-26T20:00:00Z', '2026-05-27T02:00:00Z'),
      ],
    });
    const request = buildRequest({
      workers: [tiredWorker, freshWorker],
    });

    const plan = solveShiftPlan(request);

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.workerId).toBe('wrk_fresh');
    expect(plan.assignments[0]!.fatigueAtAssignment).toBe(0);
  });
});
