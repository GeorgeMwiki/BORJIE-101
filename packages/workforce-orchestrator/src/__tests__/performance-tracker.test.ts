import { describe, expect, it } from 'vitest';
import {
  emitManualSignal,
  PERFORMANCE_WEIGHTS,
  runDeadlineMissAudit,
  runPerformanceTracker,
} from '../performance-tracker.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { WorkAssignment, WorkCheckIn } from '../types.js';

function mkAssignment(partial: Partial<WorkAssignment> = {}): WorkAssignment {
  return {
    id: partial.id ?? 'asn-1',
    tenantId: partial.tenantId ?? 't1',
    missionId: null,
    title: 'x',
    description: 'x',
    assignedEmployeeId: partial.assignedEmployeeId ?? 'emp-1',
    assignedByUserId: 'u-mgr',
    priority: 'medium',
    dueAt: partial.dueAt ?? null,
    estimatedEffortHours: null,
    status: partial.status ?? 'pending',
    riskTier: partial.riskTier ?? 'LOW',
    hitlRequired: false,
    assetRefs: [],
    createdByPersonaId: null,
    auditChainId: 'c1',
    createdAt: '2026-05-22T00:00:00Z',
    updatedAt: '2026-05-22T00:00:00Z',
    completedAt: null,
  };
}

function mkCheckIn(partial: Partial<WorkCheckIn> = {}): WorkCheckIn {
  return {
    id: partial.id ?? 'ci-1',
    tenantId: partial.tenantId ?? 't1',
    assignmentId: partial.assignmentId ?? 'asn-1',
    followupId: null,
    employeeId: partial.employeeId ?? 'emp-1',
    responseKind: partial.responseKind ?? 'progress_update',
    responseText: partial.responseText ?? null,
    attachmentsJsonb: [],
    sentimentScore: partial.sentimentScore ?? null,
    createdAt: partial.createdAt ?? '2026-05-22T12:00:00Z',
  };
}

describe('runPerformanceTracker', () => {
  it('emits on_time_completion when completed before due', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment({ dueAt: '2026-05-25T00:00:00Z' }),
      checkIn: mkCheckIn({ responseKind: 'completed' }),
    });
    expect(emitted).toContain('on_time_completion');
    expect(fx.store.signals[0]!.weight).toBe(PERFORMANCE_WEIGHTS.on_time_completion);
  });

  it('emits missed_deadline when completed after due', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T12:00:00Z' });
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment({ dueAt: '2026-05-23T00:00:00Z' }),
      checkIn: mkCheckIn({
        responseKind: 'completed',
        createdAt: '2026-05-25T12:00:00Z',
      }),
    });
    expect(emitted).toContain('missed_deadline');
  });

  it('emits repeated_blocker after threshold', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    // Seed 3 prior blockers in the window.
    for (let i = 0; i < 3; i += 1) {
      fx.store.checkIns = [
        ...fx.store.checkIns,
        mkCheckIn({
          id: `prior-${i}`,
          responseKind: 'blocker',
          createdAt: '2026-05-20T00:00:00Z',
        }),
      ];
    }
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment(),
      checkIn: mkCheckIn({ id: 'ci-new', responseKind: 'blocker' }),
    });
    expect(emitted).toContain('repeated_blocker');
  });

  it('does not emit repeated_blocker on first blocker', async () => {
    const fx = makeFixture();
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment(),
      checkIn: mkCheckIn({ responseKind: 'blocker' }),
    });
    expect(emitted).not.toContain('repeated_blocker');
  });

  it('emits positive_sentiment >= 0.5', async () => {
    const fx = makeFixture();
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment(),
      checkIn: mkCheckIn({ sentimentScore: 0.7 }),
    });
    expect(emitted).toContain('positive_sentiment');
  });

  it('emits negative_sentiment <= -0.5', async () => {
    const fx = makeFixture();
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment(),
      checkIn: mkCheckIn({ sentimentScore: -0.7 }),
    });
    expect(emitted).toContain('negative_sentiment');
  });

  it('does not emit sentiment when score is null', async () => {
    const fx = makeFixture();
    const emitted = await runPerformanceTracker(fx.deps, {
      tenantId: 't1',
      assignment: mkAssignment(),
      checkIn: mkCheckIn(),
    });
    expect(emitted.length).toBe(0);
  });
});

describe('emitManualSignal', () => {
  it('writes a manual signal with the correct weight', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    const row = await emitManualSignal(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
      signalKind: 'exceptional_work',
      note: 'closed three cases in a day',
    });
    expect(row.weight).toBe(PERFORMANCE_WEIGHTS.exceptional_work);
    expect(row.sourceKind).toBe('manual');
    expect(row.contextJsonb).toMatchObject({ note: 'closed three cases in a day' });
  });
});

describe('runDeadlineMissAudit', () => {
  it('emits missed_deadline for every overdue open assignment', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    fx.store.assignments = [
      mkAssignment({ id: 'a1', dueAt: '2026-05-22T00:00:00Z' }),
      mkAssignment({ id: 'a2', dueAt: '2026-05-23T00:00:00Z' }),
      mkAssignment({
        id: 'a3',
        dueAt: '2026-05-22T00:00:00Z',
        status: 'completed',
      }),
    ];
    const out = await runDeadlineMissAudit(fx.deps, 't1');
    expect(out).toHaveLength(2);
    expect(fx.store.signals.filter((s) => s.signalKind === 'missed_deadline')).toHaveLength(2);
  });
});
