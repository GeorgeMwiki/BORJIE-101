/**
 * Tests for the agency stall detector (K7 parity-litfin Gap G).
 *
 * Coverage:
 *   1. categoriseGoal — heuristics map known title/tool keywords to
 *      the right category and falls back to `default`.
 *   2. thresholdFor — picks the right number of days per category +
 *      honours overrides.
 *   3. lastActivityAt — picks the latest of any step timestamp and
 *      falls back to the goal's updatedAt when no steps have run.
 *   4. runStallDetection happy path — a stale goal yields exactly 3
 *      proposals (continue/block/abandon) + emits one `goal_stalled`
 *      event.
 *   5. runStallDetection threshold — fresh goal does NOT stall.
 *   6. Property-management cadence: maintenance 7d, lease-renewal 30d,
 *      payment-chase 14d each trigger correctly at their thresholds.
 *   7. Block reason inference — picks the latest failed audit row's
 *      error message when present.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  categoriseGoal,
  lastActivityAt,
  runStallDetection,
  thresholdFor,
  type StallAuditEntryShape,
  type StallEventSink,
  type StalledGoalReport,
} from '../stall-detector.js';
import type { Goal, GoalsPort } from '../goals/types.js';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date('2026-05-14T00:00:00Z').toISOString();
  return {
    id: overrides.id ?? 'g_1',
    tenantId: overrides.tenantId ?? 't1',
    userId: overrides.userId ?? 'u1',
    threadId: overrides.threadId ?? 'th_1',
    title: overrides.title ?? 'Generic goal',
    description: overrides.description ?? '',
    status: overrides.status ?? 'active',
    priority: overrides.priority ?? 'medium',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    completedAt: overrides.completedAt ?? null,
    steps: overrides.steps ?? [],
    metrics: overrides.metrics ?? { stepsTotal: 0, stepsDone: 0 },
  };
}

function makeGoalsPort(goals: ReadonlyArray<Goal>): Pick<GoalsPort, 'list'> {
  return {
    async list({ tenantId, status }) {
      return goals.filter(
        (g) =>
          g.tenantId === tenantId &&
          (status === undefined || g.status === status),
      );
    },
  };
}

describe('categoriseGoal', () => {
  it('lease/renewal/tenancy → lease-renewal', () => {
    expect(
      categoriseGoal(makeGoal({ title: 'Renewal review for A-101' })),
    ).toBe('lease-renewal');
    expect(
      categoriseGoal(
        makeGoal({ title: 'wake-tenancy hand-off', description: '' }),
      ),
    ).toBe('lease-renewal');
  });

  it('arrears/payment/rent → payment-chase', () => {
    expect(
      categoriseGoal(makeGoal({ title: 'Arrears review for l_1' })),
    ).toBe('payment-chase');
    expect(
      categoriseGoal(
        makeGoal({
          title: 'collection follow-up',
          steps: [
            {
              id: 's_1',
              seq: 1,
              description: 'send reminder',
              toolName: 'rent.send-reminder',
              toolPayload: null,
              status: 'pending',
              startedAt: null,
              endedAt: null,
              outcome: null,
              errorMessage: null,
            },
          ],
        }),
      ),
    ).toBe('payment-chase');
  });

  it('inspection/work-order → maintenance', () => {
    expect(
      categoriseGoal(
        makeGoal({
          title: 'Inspection follow-up',
          description: 'schedule maintenance for unit',
        }),
      ),
    ).toBe('maintenance');
  });

  it('uncategorised → default', () => {
    expect(categoriseGoal(makeGoal({ title: 'random task' }))).toBe('default');
  });
});

describe('thresholdFor', () => {
  it('returns built-in defaults per category', () => {
    expect(thresholdFor('lease-renewal')).toBe(30);
    expect(thresholdFor('maintenance')).toBe(7);
    expect(thresholdFor('payment-chase')).toBe(14);
    expect(thresholdFor('default')).toBe(7);
  });

  it('honours overrides', () => {
    expect(
      thresholdFor('maintenance', { maintenanceDays: 3 }),
    ).toBe(3);
  });
});

describe('lastActivityAt', () => {
  it('picks latest of endedAt / startedAt across steps', () => {
    const goal = makeGoal({
      steps: [
        {
          id: 's_1',
          seq: 1,
          description: '',
          toolName: null,
          toolPayload: null,
          status: 'done',
          startedAt: '2026-05-01T00:00:00Z',
          endedAt: '2026-05-02T00:00:00Z',
          outcome: 'ok',
          errorMessage: null,
        },
        {
          id: 's_2',
          seq: 2,
          description: '',
          toolName: null,
          toolPayload: null,
          status: 'done',
          startedAt: '2026-05-05T00:00:00Z',
          endedAt: '2026-05-06T00:00:00Z',
          outcome: 'ok',
          errorMessage: null,
        },
      ],
    });
    const last = lastActivityAt(goal);
    expect(last?.toISOString()).toBe('2026-05-06T00:00:00.000Z');
  });

  it('falls back to updatedAt when no steps have any timestamp', () => {
    const goal = makeGoal({ updatedAt: '2026-05-01T00:00:00Z' });
    expect(lastActivityAt(goal)?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('runStallDetection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('detects a stale maintenance goal (>=7d) and emits one event with 3 proposals', async () => {
    const tenDaysAgo = new Date('2026-05-04T00:00:00Z').toISOString();
    const goal = makeGoal({
      id: 'g_maint',
      title: 'Inspection follow-up',
      updatedAt: tenDaysAgo,
      steps: [
        {
          id: 's_1',
          seq: 1,
          description: 'schedule inspection',
          toolName: 'inspection.schedule',
          toolPayload: null,
          status: 'done',
          startedAt: tenDaysAgo,
          endedAt: tenDaysAgo,
          outcome: 'ok',
          errorMessage: null,
        },
        {
          id: 's_2',
          seq: 2,
          description: 'open work order',
          toolName: 'workorder.create',
          toolPayload: null,
          status: 'pending',
          startedAt: null,
          endedAt: null,
          outcome: null,
          errorMessage: null,
        },
      ],
    });
    const emitted: StalledGoalReport[] = [];
    const sink: StallEventSink = {
      emit(event, payload) {
        expect(event).toBe('goal_stalled');
        emitted.push(payload);
      },
    };
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      {
        goals: makeGoalsPort([goal]),
        eventSink: sink,
        clock: () => new Date('2026-05-14T00:00:00Z'),
      },
    );
    expect(out.scanned).toBe(1);
    expect(out.stalled).toHaveLength(1);
    const report = out.stalled[0];
    expect(report).toBeDefined();
    expect(report?.category).toBe('maintenance');
    expect(report?.threshold).toBe(7);
    expect(report?.daysSinceLastActivity).toBe(10);
    expect(report?.proposals).toHaveLength(3);
    expect(report?.proposals.map((p) => p.kind)).toEqual([
      'continue',
      'block',
      'abandon',
    ]);
    expect(emitted).toHaveLength(1);
  });

  it('does NOT detect when within the category threshold', async () => {
    // Lease-renewal threshold is 30d; goal last active 5d ago → fresh.
    const fiveDaysAgo = new Date('2026-05-09T00:00:00Z').toISOString();
    const goal = makeGoal({
      title: 'Renewal review for A-101',
      updatedAt: fiveDaysAgo,
      steps: [
        {
          id: 's_1',
          seq: 1,
          description: 'review',
          toolName: null,
          toolPayload: null,
          status: 'done',
          startedAt: fiveDaysAgo,
          endedAt: fiveDaysAgo,
          outcome: 'ok',
          errorMessage: null,
        },
      ],
    });
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      {
        goals: makeGoalsPort([goal]),
        clock: () => new Date('2026-05-14T00:00:00Z'),
      },
    );
    expect(out.stalled).toEqual([]);
  });

  it('triggers correctly at payment-chase 14d boundary', async () => {
    const fifteenDaysAgo = new Date('2026-04-29T00:00:00Z').toISOString();
    const goal = makeGoal({
      title: 'Arrears review for l_1',
      updatedAt: fifteenDaysAgo,
    });
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      {
        goals: makeGoalsPort([goal]),
        clock: () => new Date('2026-05-14T00:00:00Z'),
      },
    );
    expect(out.stalled).toHaveLength(1);
    expect(out.stalled[0]?.category).toBe('payment-chase');
    expect(out.stalled[0]?.threshold).toBe(14);
  });

  it('triggers correctly at lease-renewal 30d boundary', async () => {
    const thirtyOneDaysAgo = new Date('2026-04-13T00:00:00Z').toISOString();
    const goal = makeGoal({
      title: 'Renewal review for A-101',
      updatedAt: thirtyOneDaysAgo,
    });
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      {
        goals: makeGoalsPort([goal]),
        clock: () => new Date('2026-05-14T00:00:00Z'),
      },
    );
    expect(out.stalled).toHaveLength(1);
    expect(out.stalled[0]?.category).toBe('lease-renewal');
  });

  it('block proposal carries the latest failed audit row error message', async () => {
    const tenDaysAgo = new Date('2026-05-04T00:00:00Z').toISOString();
    const goal = makeGoal({
      title: 'Inspection follow-up',
      updatedAt: tenDaysAgo,
    });
    const auditRows: ReadonlyArray<StallAuditEntryShape> = [
      {
        goalId: goal.id,
        decision: 'failed',
        outcome: null,
        errorMessage: 'workorder.create: unit u_999 not found',
        capturedAt: tenDaysAgo,
      },
    ];
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      {
        goals: makeGoalsPort([goal]),
        auditReader: {
          async listForGoal() {
            return auditRows;
          },
        },
        clock: () => new Date('2026-05-14T00:00:00Z'),
      },
    );
    const blockProposal = out.stalled[0]?.proposals.find(
      (p) => p.kind === 'block',
    );
    expect(blockProposal?.reason).toContain('workorder.create: unit u_999');
  });

  it('returns empty when tenantId is missing', async () => {
    const out = await runStallDetection(
      { tenantId: '', userId: 'u1' },
      { goals: makeGoalsPort([]) },
    );
    expect(out.scanned).toBe(0);
    expect(out.stalled).toEqual([]);
  });

  it('does not throw when goals.list rejects — logs and returns empty', async () => {
    const port: Pick<GoalsPort, 'list'> = {
      async list() {
        throw new Error('db down');
      },
    };
    const out = await runStallDetection(
      { tenantId: 't1', userId: 'u1' },
      { goals: port },
    );
    expect(out.scanned).toBe(0);
    expect(out.stalled).toEqual([]);
  });
});
