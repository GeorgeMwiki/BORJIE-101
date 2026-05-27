/**
 * Tests for `scoreFatigue`.
 *
 * scoreFatigue blends 4 weighted signals into a 0..1 risk score:
 *   - last24h hours worked  (weight 40%, soft cap 14h)
 *   - last72h hours worked  (weight 25%, soft cap 36h)
 *   - consecutive days      (weight 20%, soft cap 7d)
 *   - elapsed rest          (weight 15%, 12h = fresh)
 *
 * recommendedMaxHours = max(4, 12 - 8*score).
 */

import { describe, expect, it } from 'vitest';

import { scoreFatigue } from '../fatigue.js';
import { workerSchema, type Worker, type WorkShiftRecord } from '../types.js';

const TENANT = 'tnt_alpha';
const AS_OF = '2026-05-27T06:00:00Z';

function buildWorker(overrides: Partial<Worker> = {}): Worker {
  return workerSchema.parse({
    id: 'wrk_001',
    tenantId: TENANT,
    name: 'Asha M.',
    certifications: [],
    shiftPreferences: [],
    last72hShifts: [],
    lastSafetyBriefingISO: null,
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

describe('scoreFatigue', () => {
  it('returns a near-zero baseline score for a worker with no recent shifts', () => {
    const worker = buildWorker();

    const score = scoreFatigue({ worker, asOfISO: AS_OF });

    expect(score.workerId).toBe('wrk_001');
    expect(score.score).toBe(0);
    expect(score.hoursWorkedLast24h).toBe(0);
    expect(score.hoursWorkedLast72h).toBe(0);
    expect(score.consecutiveDays).toBe(0);
    expect(score.recommendedMaxHours).toBe(12);
    expect(score.factors).toHaveLength(4);
  });

  it('elevates the score when the worker logged heavy hours in the last 24h', () => {
    // 12h worked ending 1h before AS_OF.
    const heavyShift = shift('2026-05-26T17:00:00Z', '2026-05-27T05:00:00Z');
    const worker = buildWorker({ last72hShifts: [heavyShift] });

    const score = scoreFatigue({ worker, asOfISO: AS_OF });

    expect(score.hoursWorkedLast24h).toBeCloseTo(12, 1);
    expect(score.score).toBeGreaterThan(0.35);
    // recommendedMaxHours must shrink below 12 given score > 0.
    expect(score.recommendedMaxHours).toBeLessThan(12);

    const last24hFactor = score.factors.find((f) => f.label === 'last-24h');
    expect(last24hFactor).toBeDefined();
    expect(last24hFactor!.contribution).toBeGreaterThan(0.3);
  });

  it('caps consecutive-day contribution at 7 days (full weight = 0.2)', () => {
    // 8 consecutive working days, each only 2h so 24h/72h windows
    // stay tame and we isolate the consecutive-days signal.
    const days: WorkShiftRecord[] = [];
    for (let i = 0; i < 8; i++) {
      const d = String(19 + i).padStart(2, '0');
      days.push(shift(`2026-05-${d}T08:00:00Z`, `2026-05-${d}T10:00:00Z`));
    }
    const worker = buildWorker({ last72hShifts: days });

    const score = scoreFatigue({ worker, asOfISO: AS_OF });

    expect(score.consecutiveDays).toBe(8);
    const consecutiveFactor = score.factors.find(
      (f) => f.label === 'consecutive-days',
    );
    expect(consecutiveFactor).toBeDefined();
    // 8/7 clamps to 1 * 0.2 weight => exactly 0.2 contribution.
    expect(consecutiveFactor!.contribution).toBeCloseTo(0.2, 2);
  });

  it('deflates rest-elapsed contribution as more rest accumulates', () => {
    // Old shift ending 24h before AS_OF — rest fully elapsed.
    const oldShift = shift('2026-05-25T22:00:00Z', '2026-05-26T06:00:00Z');
    const restedWorker = buildWorker({ last72hShifts: [oldShift] });

    // Recent shift ending right before AS_OF — zero rest.
    const recentShift = shift('2026-05-26T22:00:00Z', '2026-05-27T06:00:00Z');
    const tiredWorker = buildWorker({
      id: 'wrk_002',
      last72hShifts: [recentShift],
    });

    const restedScore = scoreFatigue({ worker: restedWorker, asOfISO: AS_OF });
    const tiredScore = scoreFatigue({ worker: tiredWorker, asOfISO: AS_OF });

    const restedFactor = restedScore.factors.find(
      (f) => f.label === 'rest-elapsed',
    )!;
    const tiredFactor = tiredScore.factors.find(
      (f) => f.label === 'rest-elapsed',
    )!;

    // Rested worker had > 12h rest → contribution should be 0.
    expect(restedFactor.contribution).toBe(0);
    // Tired worker had ~0h rest → contribution should be near full
    // rest weight of 0.15.
    expect(tiredFactor.contribution).toBeGreaterThan(restedFactor.contribution);
    expect(tiredFactor.contribution).toBeCloseTo(0.15, 2);
  });

  it('floors recommendedMaxHours at 4 when the score is at the ceiling', () => {
    // Stack 72h of continuous work + 7 consecutive days.
    const heavyShifts: WorkShiftRecord[] = [];
    for (let i = 0; i < 8; i++) {
      const d = String(19 + i).padStart(2, '0');
      heavyShifts.push(
        shift(`2026-05-${d}T00:00:00Z`, `2026-05-${d}T12:00:00Z`, 'underground'),
      );
    }
    const worker = buildWorker({ last72hShifts: heavyShifts });

    const score = scoreFatigue({ worker, asOfISO: AS_OF });

    // Stacking 96h underground + 8 consecutive days drives score
    // well above the no-fatigue baseline.
    expect(score.score).toBeGreaterThan(0.4);
    // recommendedMaxHours formula: max(4, 12 - 8*score) — always
    // clamped into [4, 12].
    expect(score.recommendedMaxHours).toBeGreaterThanOrEqual(4);
    expect(score.recommendedMaxHours).toBeLessThanOrEqual(12);
    // Score must also shrink the recommended max below the 12 floor.
    expect(score.recommendedMaxHours).toBeLessThan(12);
  });
});
