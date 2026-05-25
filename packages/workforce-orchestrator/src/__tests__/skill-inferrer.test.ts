import { describe, expect, it } from 'vitest';
import {
  bucketBySkill,
  runSkillInferrer,
  SKILL_MAP,
  sigmoid,
} from '../skill-inferrer.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { PerformanceSignal, SkillAssessment } from '../types.js';

describe('sigmoid', () => {
  it('centres at 0 → 0.5', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  it('saturates toward 1 for large positive', () => {
    expect(sigmoid(100)).toBeGreaterThan(0.99);
  });

  it('saturates toward 0 for large negative', () => {
    expect(sigmoid(-100)).toBeLessThan(0.01);
  });

  it('returns 0.5 for non-finite input', () => {
    expect(sigmoid(Number.NaN)).toBe(0.5);
  });
});

describe('bucketBySkill', () => {
  it('produces a bucket per mapped skill', () => {
    const sigs: PerformanceSignal[] = [
      {
        id: 's1',
        tenantId: 't1',
        employeeId: 'e1',
        signalKind: 'on_time_completion',
        weight: 1,
        contextJsonb: {},
        sourceKind: 'check_in',
        sourceRef: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ];
    const buckets = bucketBySkill(sigs, Date.parse('2026-05-22T00:00:00Z'));
    expect(buckets.get('execution_discipline')).toBeGreaterThan(0);
    expect(buckets.get('time_management')).toBeGreaterThan(0);
  });

  it('decays older signals', () => {
    const recent: PerformanceSignal = {
      id: 'recent',
      tenantId: 't1',
      employeeId: 'e1',
      signalKind: 'on_time_completion',
      weight: 1,
      contextJsonb: {},
      sourceKind: 'check_in',
      sourceRef: null,
      createdAt: '2026-05-22T00:00:00Z',
    };
    const old: PerformanceSignal = { ...recent, id: 'old', createdAt: '2026-04-01T00:00:00Z' };
    const bRecent = bucketBySkill([recent], Date.parse('2026-05-22T00:00:00Z'));
    const bOld = bucketBySkill([old], Date.parse('2026-05-22T00:00:00Z'));
    expect(bRecent.get('execution_discipline')!).toBeGreaterThan(
      bOld.get('execution_discipline')!
    );
  });

  it('ignores unknown signal kinds', () => {
    // @ts-expect-error - intentionally unknown signalKind value
    const sigs: PerformanceSignal[] = [
      {
        id: 's1',
        tenantId: 't1',
        employeeId: 'e1',
        signalKind: 'unknown_kind',
        weight: 1,
        contextJsonb: {},
        sourceKind: 'check_in',
        sourceRef: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ];
    const buckets = bucketBySkill(sigs, Date.parse('2026-05-22T00:00:00Z'));
    expect(buckets.size).toBe(0);
  });

  it('exposes SKILL_MAP for composition root extension', () => {
    expect(SKILL_MAP['on_time_completion']).toContain('execution_discipline');
  });
});

describe('runSkillInferrer', () => {
  it('writes skill_assessments per mapped skill', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    fx.store.signals = [
      {
        id: 's1',
        tenantId: 't1',
        employeeId: 'emp-1',
        signalKind: 'on_time_completion',
        weight: 1,
        contextJsonb: {},
        sourceKind: 'check_in',
        sourceRef: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ];
    const out = await runSkillInferrer(fx.deps, { tenantId: 't1', employeeId: 'emp-1' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.proficiencyScore >= 0 && s.proficiencyScore <= 1)).toBe(true);
  });

  it('does not overwrite manager_rated rows', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    const locked: SkillAssessment = {
      id: 'sk-locked',
      tenantId: 't1',
      employeeId: 'emp-1',
      skillSlug: 'execution_discipline',
      proficiencyScore: 0.9,
      lastAssessedAt: '2026-04-01T00:00:00Z',
      sourceKind: 'manager_rated',
    };
    fx.store.skills = [locked];

    fx.store.signals = [
      {
        id: 's1',
        tenantId: 't1',
        employeeId: 'emp-1',
        signalKind: 'missed_deadline',
        weight: -1.5,
        contextJsonb: {},
        sourceKind: 'audit_event',
        sourceRef: null,
        createdAt: '2026-05-22T00:00:00Z',
      },
    ];
    await runSkillInferrer(fx.deps, { tenantId: 't1', employeeId: 'emp-1' });
    const lockedAfter = fx.store.skills.find(
      (s) => s.skillSlug === 'execution_discipline'
    );
    expect(lockedAfter!.proficiencyScore).toBe(0.9);
    expect(lockedAfter!.sourceKind).toBe('manager_rated');
  });

  it('produces lower scores when negative signals dominate', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    for (let i = 0; i < 5; i += 1) {
      fx.store.signals = [
        ...fx.store.signals,
        {
          id: `n${i}`,
          tenantId: 't1',
          employeeId: 'emp-1',
          signalKind: 'missed_deadline',
          weight: -1.5,
          contextJsonb: {},
          sourceKind: 'audit_event',
          sourceRef: null,
          createdAt: '2026-05-22T00:00:00Z',
        },
      ];
    }
    const out = await runSkillInferrer(fx.deps, { tenantId: 't1', employeeId: 'emp-1' });
    const execRow = out.find((s) => s.skillSlug === 'execution_discipline');
    expect(execRow!.proficiencyScore).toBeLessThan(0.5);
  });
});
