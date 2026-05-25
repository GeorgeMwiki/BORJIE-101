import { describe, expect, it } from 'vitest';
import { generateAdvisoryBrief, rollupStats } from '../advisory-brief-engine.js';
import { makeFixture } from './fixtures.js';
import type { PerformanceSignal, WorkforceKpi } from '../types.js';

describe('rollupStats', () => {
  it('sums per-day counters', () => {
    const kpis: WorkforceKpi[] = [
      {
        id: 'k1',
        tenantId: 't1',
        day: '2026-05-15',
        totalAssignments: 10,
        completedOnTime: 8,
        overdue: 1,
        blockersOpen: 0,
        avgCompletionHours: 4,
      },
      {
        id: 'k2',
        tenantId: 't1',
        day: '2026-05-16',
        totalAssignments: 6,
        completedOnTime: 5,
        overdue: 0,
        blockersOpen: 1,
        avgCompletionHours: 6,
      },
    ];
    const r = rollupStats({ kpis, signals: [] });
    expect(r.totalAssignments).toBe(16);
    expect(r.completedOnTime).toBe(13);
    expect(r.overdue).toBe(1);
    expect(r.blockersOpen).toBe(1);
    expect(r.avgCompletionHours).toBe(5);
    expect(r.onTimeRate).toBeCloseTo(13 / 16);
  });

  it('handles empty input', () => {
    const r = rollupStats({ kpis: [], signals: [] });
    expect(r.totalAssignments).toBe(0);
    expect(r.onTimeRate).toBe(0);
    expect(r.avgCompletionHours).toBeNull();
  });

  it('aggregates signals by kind', () => {
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
        createdAt: '2026-05-15T00:00:00Z',
      },
      {
        id: 's2',
        tenantId: 't1',
        employeeId: 'e1',
        signalKind: 'on_time_completion',
        weight: 1,
        contextJsonb: {},
        sourceKind: 'check_in',
        sourceRef: null,
        createdAt: '2026-05-16T00:00:00Z',
      },
      {
        id: 's3',
        tenantId: 't1',
        employeeId: 'e1',
        signalKind: 'missed_deadline',
        weight: -1.5,
        contextJsonb: {},
        sourceKind: 'audit_event',
        sourceRef: null,
        createdAt: '2026-05-17T00:00:00Z',
      },
    ];
    const r = rollupStats({ kpis: [], signals: sigs });
    expect(r.signalsByKind['on_time_completion']).toBe(2);
    expect(r.signalsByKind['missed_deadline']).toBe(1);
  });
});

describe('generateAdvisoryBrief', () => {
  it('writes a brief, audit chain, and persists to store', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T00:00:00Z' });
    fx.store.kpis = [
      {
        id: 'k1',
        tenantId: 't1',
        day: '2026-05-15',
        totalAssignments: 10,
        completedOnTime: 8,
        overdue: 1,
        blockersOpen: 0,
        avgCompletionHours: 4,
      },
    ];
    fx.content.advisoryDraft = {
      gaps: [{ title: 'slow inspections', severity: 'medium', evidenceRefs: [] }],
      opportunities: [],
      recommendedActions: [
        { title: 'add 2nd inspector', severity: 'medium', expectedImpact: 'cut wait time by 40%' },
      ],
      citations: [],
      overallScore: 72,
    };
    const brief = await generateAdvisoryBrief(fx.deps, {
      tenantId: 't1',
      audiencePersonaId: 'persona-T3',
      periodStart: '2026-05-15',
      periodEnd: '2026-05-22',
    });

    expect(brief.gapsJsonb).toHaveLength(1);
    expect(brief.recommendedActionsJsonb).toHaveLength(1);
    expect(brief.overallScore).toBe(72);
    expect(brief.auditChainId).toBeTruthy();
    expect(fx.store.briefs).toHaveLength(1);
    expect(fx.audit.appended[0]!.action).toBe('workforce.advisory_brief');
  });

  it('clamps overallScore into [0,100]', async () => {
    const fx = makeFixture();
    fx.content.advisoryDraft = {
      gaps: [],
      opportunities: [],
      recommendedActions: [],
      citations: [],
      overallScore: 999,
    };
    const b = await generateAdvisoryBrief(fx.deps, {
      tenantId: 't1',
      periodStart: '2026-05-22',
      periodEnd: '2026-05-22',
    });
    expect(b.overallScore).toBe(100);
  });

  it('handles content.draftAdvisoryBrief returning -Infinity', async () => {
    const fx = makeFixture();
    fx.content.advisoryDraft = {
      gaps: [],
      opportunities: [],
      recommendedActions: [],
      citations: [],
      overallScore: Number.NEGATIVE_INFINITY,
    };
    const b = await generateAdvisoryBrief(fx.deps, {
      tenantId: 't1',
      periodStart: '2026-05-22',
      periodEnd: '2026-05-22',
    });
    expect(b.overallScore).toBe(0);
  });
});
