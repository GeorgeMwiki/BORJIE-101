import { describe, expect, it } from 'vitest';
import {
  BLOCKED_THRESHOLD_MS,
  OVERDUE_THRESHOLD_MS,
  runEscalationOnce,
} from '../escalation-rules.js';
import { makeFixture, seedEmployee } from './fixtures.js';
import type { WorkAssignment } from '../types.js';

function seedAssignment(
  fx: ReturnType<typeof makeFixture>,
  partial: Partial<WorkAssignment> & Pick<WorkAssignment, 'id'>
): WorkAssignment {
  const row: WorkAssignment = {
    id: partial.id,
    tenantId: partial.tenantId ?? 't1',
    missionId: null,
    title: partial.title ?? 'task',
    description: 'x',
    assignedEmployeeId: partial.assignedEmployeeId ?? 'emp-1',
    assignedByUserId: 'u-mgr',
    priority: partial.priority ?? 'medium',
    dueAt: partial.dueAt ?? null,
    estimatedEffortHours: null,
    status: partial.status ?? 'pending',
    riskTier: partial.riskTier ?? 'LOW',
    hitlRequired: false,
    assetRefs: [],
    createdByPersonaId: null,
    auditChainId: 'c1',
    createdAt: '2026-05-22T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2026-05-22T00:00:00Z',
    completedAt: null,
  };
  fx.store.assignments = [...fx.store.assignments, row];
  return row;
}

describe('runEscalationOnce', () => {
  it('opens a ticket for blocked-too-long', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, {
      id: 'emp-1',
      tenantId: 't1',
      personEntityId: 'p1',
      managerEmployeeId: 'emp-mgr',
    });
    seedEmployee(fx.store, {
      id: 'emp-mgr',
      tenantId: 't1',
      personEntityId: 'p-mgr',
    });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'blocked',
      updatedAt: '2026-05-23T00:00:00Z', // > 24h ago
    });
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r).toHaveLength(1);
    expect(r[0]!.reason).toBe('blocked_too_long');
    expect(fx.tickets.created).toHaveLength(1);
    expect(fx.tickets.created[0]!.assigneeUserId).toBe('p-mgr');
  });

  it('opens a ticket for overdue', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'pending',
      dueAt: '2026-05-22T00:00:00Z',
    });
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r).toHaveLength(1);
    expect(r[0]!.reason).toBe('overdue');
  });

  it('escalates severity for SOVEREIGN risk tier', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'pending',
      dueAt: '2026-05-22T00:00:00Z',
      riskTier: 'SOVEREIGN',
    });
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r[0]!.severity).toBe('critical');
  });

  it('falls back to assigned_by_user_id when no manager', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'blocked',
      updatedAt: '2026-05-23T00:00:00Z',
    });
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r).toHaveLength(1);
    expect(fx.tickets.created[0]!.assigneeUserId).toBe('u-mgr');
  });

  it('does not escalate overdue under the threshold', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T00:10:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'pending',
      dueAt: '2026-05-22T00:00:00Z',
    });
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r).toHaveLength(0);
  });

  it('keeps thresholds exposed as constants', () => {
    expect(BLOCKED_THRESHOLD_MS).toBe(24 * 3_600_000);
    expect(OVERDUE_THRESHOLD_MS).toBe(3_600_000);
  });

  it('still escalates even if audit append fails', async () => {
    const fx = makeFixture({ nowIso: '2026-05-25T00:00:00Z' });
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    seedAssignment(fx, {
      id: 'asn-1',
      status: 'blocked',
      updatedAt: '2026-05-23T00:00:00Z',
    });
    (fx.deps as { audit: { append: () => Promise<never> } }).audit = {
      append: () => {
        throw new Error('audit failure');
      },
    };
    const r = await runEscalationOnce(fx.deps, 't1');
    expect(r).toHaveLength(1);
  });
});
