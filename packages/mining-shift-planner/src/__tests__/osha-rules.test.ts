/**
 * Tests for the OSHA-TZ ruleset.
 *
 * Five rules:
 *   R1 — max-shift-length + min-rest-between-shifts
 *   R2 — max consecutive working days
 *   R3a — underground weekly max hours
 *   R4 — pre-shift safety briefing freshness
 *   R5 — heat-stress rotation requirement
 *
 * Plus `buildComplianceReport` aggregates blocking failures.
 */

import { describe, expect, it } from 'vitest';

import {
  buildComplianceReport,
  DEFAULT_OSHA_THRESHOLDS,
  evaluateOshaRules,
} from '../osha-rules.js';
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
const BRIEFING_FRESH = '2026-05-27T01:00:00Z'; // 5h before shift start.

function baseEquipment(overrides: Partial<Equipment> = {}): Equipment {
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

function baseTask(overrides: Partial<ShiftTask> = {}): ShiftTask {
  return {
    id: 'tsk_haul',
    zone: 'surface-pit',
    requiredEquipment: ['haul-truck'],
    requiredCertifications: ['haul-truck-license'],
    estimatedHours: 8,
    ...overrides,
  };
}

function baseWorker(overrides: Partial<Worker> = {}): Worker {
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

function buildRequest(overrides: Partial<ShiftRequest> = {}): ShiftRequest {
  return shiftRequestSchema.parse({
    tenantId: TENANT,
    siteId: SITE,
    shiftStartISO: SHIFT_START,
    durationHours: 8,
    shiftKind: 'morning',
    workers: [baseWorker()],
    equipment: [baseEquipment()],
    tasks: [baseTask()],
    ambientTemperatureC: 28,
    ...overrides,
  });
}

function shift(
  startISO: string,
  endISO: string,
  zone: WorkShiftRecord['zone'] = 'surface-pit',
): WorkShiftRecord {
  return { shiftId: `shf_${startISO}`, startISO, endISO, zone };
}

describe('evaluateOshaRules — R1 shift-length + rest', () => {
  it('passes when shift length and rest are both within limits', () => {
    const request = buildRequest();

    const r1 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r1');

    expect(r1).toBeDefined();
    expect(r1!.pass).toBe(true);
    expect(r1!.severity).toBe('info');
    expect(r1!.affectedWorkerIds).toEqual([]);
  });

  it('fails R1 when a worker had less than the minimum rest before the shift', () => {
    // Worker's last shift ended just 4h before shift start (< 10h min).
    const violator = baseWorker({
      id: 'wrk_no_rest',
      last72hShifts: [
        shift('2026-05-26T18:00:00Z', '2026-05-27T02:00:00Z'),
      ],
    });
    const request = buildRequest({
      workers: [baseWorker(), violator],
    });

    const r1 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r1')!;

    expect(r1.pass).toBe(false);
    expect(r1.severity).toBe('high');
    expect(r1.affectedWorkerIds).toContain('wrk_no_rest');
  });
});

describe('evaluateOshaRules — R2 consecutive days', () => {
  it('fails R2 when a worker has worked the maximum consecutive days', () => {
    const days: WorkShiftRecord[] = [];
    for (let i = 0; i < 6; i++) {
      const d = String(21 + i).padStart(2, '0');
      days.push(shift(`2026-05-${d}T08:00:00Z`, `2026-05-${d}T10:00:00Z`));
    }
    const overworked = baseWorker({
      id: 'wrk_overworked',
      last72hShifts: days,
    });
    const request = buildRequest({ workers: [overworked] });

    const r2 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r2')!;

    expect(r2.pass).toBe(false);
    expect(r2.affectedWorkerIds).toContain('wrk_overworked');
    expect(r2.severity).toBe('high');
  });

  it('passes R2 when no worker hits the consecutive-day cap', () => {
    const request = buildRequest();

    const r2 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r2')!;

    expect(r2.pass).toBe(true);
    expect(r2.affectedWorkerIds).toEqual([]);
  });
});

describe('evaluateOshaRules — R3a underground weekly hours', () => {
  it('fails R3a when underground 72h-extrapolated weekly hours exceed cap', () => {
    // 30h underground in last 72h → weeklyEstimate = (30/72)*168 ≈ 70h.
    const undergroundWorker = baseWorker({
      id: 'wrk_underground',
      certifications: ['underground-cert'],
      last72hShifts: [
        shift('2026-05-24T00:00:00Z', '2026-05-24T10:00:00Z', 'underground'),
        shift('2026-05-25T00:00:00Z', '2026-05-25T10:00:00Z', 'underground'),
        shift('2026-05-26T00:00:00Z', '2026-05-26T10:00:00Z', 'underground'),
      ],
    });
    const request = buildRequest({ workers: [undergroundWorker] });

    const r3 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r3a')!;

    expect(r3.pass).toBe(false);
    expect(r3.affectedWorkerIds).toContain('wrk_underground');
    expect(r3.severity).toBe('high');
  });
});

describe('evaluateOshaRules — R4 safety briefing', () => {
  it('fails R4 critically when a worker has no recorded safety briefing', () => {
    const stale = baseWorker({
      id: 'wrk_stale',
      lastSafetyBriefingISO: null,
    });
    const request = buildRequest({ workers: [stale] });

    const r4 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r4')!;

    expect(r4.pass).toBe(false);
    expect(r4.severity).toBe('critical');
    expect(r4.affectedWorkerIds).toContain('wrk_stale');
  });

  it('passes R4 when all workers have briefings within the freshness window', () => {
    const request = buildRequest();

    const r4 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r4')!;

    expect(r4.pass).toBe(true);
    expect(r4.severity).toBe('info');
  });
});

describe('evaluateOshaRules — R5 heat stress', () => {
  it('passes R5 when ambient temperature is below the threshold', () => {
    const request = buildRequest({ ambientTemperatureC: 30 });

    const r5 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r5')!;

    expect(r5.pass).toBe(true);
    expect(r5.detail).toContain('not required');
  });

  it('flags R5 high-severity failure when only one worker is available in hot weather', () => {
    const request = buildRequest({
      ambientTemperatureC: 40, // > 35°C threshold.
      workers: [baseWorker()], // single worker → cannot rotate.
    });

    const r5 = evaluateOshaRules(request).find((r) => r.ruleId === 'osha-tz-r5')!;

    expect(r5.pass).toBe(false);
    expect(r5.severity).toBe('high');
    expect(r5.affectedWorkerIds.length).toBeGreaterThan(0);
  });
});

describe('buildComplianceReport', () => {
  it('aggregates all rules and reports blocking failures with code prefix', () => {
    // Concoct a request that breaks R4 (no briefing) → critical.
    const broken = baseWorker({
      id: 'wrk_no_brief',
      lastSafetyBriefingISO: null,
    });
    const request = buildRequest({ workers: [broken] });

    const report = buildComplianceReport(request, null, DEFAULT_OSHA_THRESHOLDS);

    expect(report.tenantId).toBe(TENANT);
    expect(report.siteId).toBe(SITE);
    expect(report.results).toHaveLength(5);
    expect(report.pass).toBe(false);
    expect(report.blockingFailures.length).toBeGreaterThan(0);
    expect(report.blockingFailures[0]).toMatch(/^osha-tz-r/);
  });

  it('returns pass=true with no blocking failures on a clean request', () => {
    const request = buildRequest();

    const report = buildComplianceReport(request, null);

    expect(report.pass).toBe(true);
    expect(report.blockingFailures).toEqual([]);
    expect(report.results.every((r) => r.pass)).toBe(true);
  });
});
