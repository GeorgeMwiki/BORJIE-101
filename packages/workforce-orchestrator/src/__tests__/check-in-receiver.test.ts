import { describe, expect, it } from 'vitest';
import { receiveCheckIn } from '../check-in-receiver.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { WorkAssignment, WorkFollowup } from '../types.js';

function seedAssignment(
  fx: ReturnType<typeof makeFixture>,
  partial: Partial<WorkAssignment> & Pick<WorkAssignment, 'id' | 'assignedEmployeeId'>
): WorkAssignment {
  const row: WorkAssignment = {
    id: partial.id,
    tenantId: partial.tenantId ?? 't1',
    missionId: null,
    title: partial.title ?? 'x',
    description: 'x',
    assignedEmployeeId: partial.assignedEmployeeId,
    assignedByUserId: 'u-mgr',
    priority: partial.priority ?? 'medium',
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
  partial: Partial<WorkFollowup> & Pick<WorkFollowup, 'id' | 'assignmentId'>
): WorkFollowup {
  const row: WorkFollowup = {
    id: partial.id,
    tenantId: partial.tenantId ?? 't1',
    assignmentId: partial.assignmentId,
    scheduledAt: partial.scheduledAt ?? '2026-05-22T08:00:00Z',
    cadenceKind: 'daily',
    channel: 'whatsapp',
    status: partial.status ?? 'sent',
    createdAt: '2026-05-22T00:00:00Z',
  };
  fx.store.followups = [...fx.store.followups, row];
  return row;
}

describe('receiveCheckIn', () => {
  it('flips assignment → in_progress on progress_update', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });

    const r = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'progress_update',
      responseText: 'half way done',
    });

    expect(r.assignment.status).toBe('in_progress');
    expect(r.checkIn.responseKind).toBe('progress_update');
    expect(typeof r.checkIn.sentimentScore === 'number' || r.checkIn.sentimentScore === null).toBe(true);
  });

  it('flips assignment → blocked on blocker', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });

    const r = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'blocker',
      responseText: 'I am stuck and frustrated',
    });
    expect(r.assignment.status).toBe('blocked');
  });

  it('flips assignment → completed and stamps completedAt', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      assignedEmployeeId: 'emp-1',
      dueAt: '2026-05-23T12:00:00Z',
    });
    const r = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'completed',
      responseText: 'done',
    });
    expect(r.assignment.status).toBe('completed');
    expect(r.assignment.completedAt).toBeTruthy();
    expect(r.emittedSignalKinds).toContain('on_time_completion');
  });

  it('emits missed_deadline when completed after due', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      assignedEmployeeId: 'emp-1',
      dueAt: '2026-05-23T12:00:00Z',
    });
    const r = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'completed',
    });
    expect(r.emittedSignalKinds).toContain('missed_deadline');
  });

  it('flips followup → responded when linked', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });
    seedFollowup(fx, { id: 'fu-1', assignmentId: 'asn-1' });

    await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      followupId: 'fu-1',
      responseKind: 'progress_update',
    });
    expect(fx.store.followups[0]!.status).toBe('responded');
  });

  it('refuses if employee is not the assignee', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });
    await expect(
      receiveCheckIn(fx.deps, {
        tenantId: 't1',
        assignmentId: 'asn-1',
        employeeId: 'emp-other',
        responseKind: 'progress_update',
      })
    ).rejects.toThrow();
  });

  it('refuses if assignment is missing', async () => {
    const fx = makeFixture();
    await expect(
      receiveCheckIn(fx.deps, {
        tenantId: 't1',
        assignmentId: 'ghost',
        employeeId: 'emp-1',
        responseKind: 'progress_update',
      })
    ).rejects.toThrow();
  });

  it('preserves immutability of the seeded assignment row', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    const original = seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });
    const originalStatus = original.status;
    await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'progress_update',
    });
    expect(original.status).toBe(originalStatus); // never mutated
  });

  it('records attachments verbatim', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T12:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, { id: 'asn-1', assignedEmployeeId: 'emp-1' });
    const r = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: 'asn-1',
      employeeId: 'emp-1',
      responseKind: 'progress_update',
      attachments: [{ kind: 'photo', url: 'https://x/y.jpg' }],
    });
    expect(r.checkIn.attachmentsJsonb).toHaveLength(1);
  });
});
