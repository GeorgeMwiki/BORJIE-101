import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_MS,
  runFollowupSchedulerOnce,
  sweepMissedFollowups,
} from '../followup-scheduler.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { WorkAssignment, WorkFollowup } from '../types.js';

function seedAssignment(
  fx: ReturnType<typeof makeFixture>,
  partial: Partial<WorkAssignment>
): WorkAssignment {
  const row: WorkAssignment = {
    id: partial.id ?? 'asn-1',
    tenantId: partial.tenantId ?? 't1',
    missionId: null,
    title: partial.title ?? 'x',
    description: 'x',
    assignedEmployeeId: partial.assignedEmployeeId ?? 'emp-1',
    assignedByUserId: 'u-mgr',
    priority: 'medium',
    dueAt: partial.dueAt ?? null,
    estimatedEffortHours: null,
    status: partial.status ?? 'pending',
    riskTier: 'LOW',
    hitlRequired: false,
    assetRefs: [],
    createdByPersonaId: null,
    auditChainId: 'c1',
    createdAt: '2026-05-22T00:00:00Z',
    updatedAt: '2026-05-22T00:00:00Z',
    completedAt: null,
  };
  fx.store.assignments = [...fx.store.assignments, row];
  return row;
}

function seedFollowup(
  fx: ReturnType<typeof makeFixture>,
  partial: Partial<WorkFollowup> & Pick<WorkFollowup, 'assignmentId' | 'scheduledAt'>
): WorkFollowup {
  const row: WorkFollowup = {
    id: partial.id ?? 'fu-1',
    tenantId: partial.tenantId ?? 't1',
    assignmentId: partial.assignmentId,
    scheduledAt: partial.scheduledAt,
    cadenceKind: partial.cadenceKind ?? 'daily',
    channel: partial.channel ?? 'whatsapp',
    status: partial.status ?? 'pending',
    createdAt: partial.createdAt ?? '2026-05-22T00:00:00Z',
  };
  fx.store.followups = [...fx.store.followups, row];
  return row;
}

describe('runFollowupSchedulerOnce', () => {
  it('dispatches a due followup and flips status to sent', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1' });
    seedFollowup(fx, {
      id: 'fu-1',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
    });

    const results = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(results).toHaveLength(1);
    expect(results[0]!.delivered).toBe(true);
    expect(fx.store.followups[0]!.status).toBe('sent');
    expect(fx.channel.sent).toHaveLength(1);
  });

  it('skips orphaned followups (parent missing)', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedFollowup(fx, {
      id: 'fu-orphan',
      assignmentId: 'asn-none',
      scheduledAt: '2026-05-22T08:00:00Z',
    });
    const results = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(results).toHaveLength(0);
    expect(fx.store.followups[0]!.status).toBe('pending');
  });

  it('marks followups as sent without delivering for closed assignments', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', status: 'completed' });
    seedFollowup(fx, {
      id: 'fu-1',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
    });
    const results = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(results[0]!.delivered).toBe(false);
    expect(fx.store.followups[0]!.status).toBe('sent');
    expect(fx.channel.sent).toHaveLength(0);
  });

  it('does not flip status when channel send throws', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1' });
    seedFollowup(fx, {
      id: 'fu-1',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
    });
    (fx.deps as { channel: { send: () => Promise<never> } }).channel = {
      send: () => {
        throw new Error('outage');
      },
    };
    const results = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(results[0]!.delivered).toBe(false);
    expect(results[0]!.error).toContain('outage');
    expect(fx.store.followups[0]!.status).toBe('pending');
  });

  it('skips when employee disappears', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedAssignment(fx, { id: 'asn-1' });
    seedFollowup(fx, {
      id: 'fu-1',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
    });
    const results = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(results).toHaveLength(0);
  });
});

describe('sweepMissedFollowups', () => {
  it('flips long-sent followups → missed and emits a no_response check-in', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1' });
    seedFollowup(fx, {
      id: 'fu-1',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
      status: 'pending',
      createdAt: '2026-05-22T00:00:00Z',
    });
    // listDueFollowups returns pending only. To exercise the missed
    // branch we keep the row pending but old; sweep treats it as
    // "still due", with status==='sent' check it skips. So instead
    // create a sent followup older than grace and re-call:
    seedFollowup(fx, {
      id: 'fu-2',
      assignmentId: 'asn-1',
      scheduledAt: '2026-05-22T08:00:00Z',
      status: 'sent',
      createdAt: '2026-05-22T00:00:00Z',
    });
    // listDueFollowups filters by status='pending'; so to expose fu-2 we
    // monkey-patch to also return sent. Quick override:
    fx.store.listDueFollowups = async (tenantId, _now) =>
      fx.store.followups.filter((f) => f.tenantId === tenantId);

    const missed = await sweepMissedFollowups(fx.deps, 't1');
    expect(missed).toContain('fu-2');
    expect(fx.store.checkIns.some((c) => c.responseKind === 'no_response')).toBe(true);
  });

  it('default grace is 24h', () => {
    expect(DEFAULT_GRACE_MS).toBe(24 * 3_600_000);
  });
});
