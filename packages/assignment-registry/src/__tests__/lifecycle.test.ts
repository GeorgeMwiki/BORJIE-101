/**
 * Lifecycle tests — assign, revoke, pause/resume, extend, capability +
 * scopeRef mutations, bulk, idempotency, event-log invariants.
 */

import { describe, expect, it } from 'vitest';
import {
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
  createLifecycleManager,
  createIdGen,
} from '../index.js';

const T = 'tenant-1';

function build(now?: () => Date) {
  const repo = createInMemoryAssignmentRepository();
  const events = createInMemoryAssignmentEventRepository();
  const lifecycle = createLifecycleManager({
    assignmentRepository: repo,
    eventRepository: events,
    idGen: createIdGen(),
    ...(now !== undefined ? { now } : {}),
  });
  return { repo, events, lifecycle };
}

describe('lifecycle — assignUser', () => {
  it('creates an active assignment and a created event', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    expect(a.status).toBe('active');
    expect(a.scopeRefs).toEqual(['p1']);
    const log = await events.listForAssignment(a.id);
    expect(log).toHaveLength(1);
    expect(log[0]!.kind).toBe('created');
  });

  it('is idempotent on the same (scope, scopeRefs, capabilities) tuple', async () => {
    const { lifecycle, events } = build();
    const a1 = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1', 'p2'],
      capabilities: ['view', 'polygon_edit'],
      assignedBy: 'admin',
    });
    const a2 = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p2', 'p1'], // reordered — set semantics
      capabilities: ['polygon_edit', 'view'],
      assignedBy: 'admin',
    });
    expect(a2.id).toBe(a1.id);
    const log = await events.listForAssignment(a1.id);
    expect(log).toHaveLength(1);
  });

  it('honours optional startsAt / endsAt / reason / metadata', async () => {
    const { lifecycle } = build();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'tender',
      scopeRefs: ['t1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      startsAt: future,
      endsAt: end,
      reason: 'temporary tender review',
      metadata: { ticket: 'JIRA-123' },
    });
    expect(a.startsAt.getTime()).toBe(future.getTime());
    expect(a.endsAt?.getTime()).toBe(end.getTime());
    expect(a.reason).toBe('temporary tender review');
    expect(a.metadata.ticket).toBe('JIRA-123');
  });
});

describe('lifecycle — revoke', () => {
  it('flips status to revoked and writes one event', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const r = await lifecycle.revokeAssignment(a.id, 'admin', 'no longer needed');
    expect(r.status).toBe('revoked');
    const log = await events.listForAssignment(a.id);
    expect(log.map((e) => e.kind)).toEqual(['created', 'revoked']);
    expect(log[1]!.payload.reason).toBe('no longer needed');
  });

  it('is a no-op when called on an already-revoked assignment', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.revokeAssignment(a.id, 'admin');
    await lifecycle.revokeAssignment(a.id, 'admin');
    const log = await events.listForAssignment(a.id);
    expect(log).toHaveLength(2);
  });

  it('throws when the assignment does not exist', async () => {
    const { lifecycle } = build();
    await expect(
      lifecycle.revokeAssignment('does-not-exist', 'admin'),
    ).rejects.toThrow(/assignment_not_found/);
  });
});

describe('lifecycle — pause / resume', () => {
  it('pause then resume returns assignment to active', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const p = await lifecycle.pauseAssignment(a.id, 'admin', 'leave');
    expect(p.status).toBe('paused');
    const r = await lifecycle.resumeAssignment(a.id, 'admin');
    expect(r.status).toBe('active');
    const log = await events.listForAssignment(a.id);
    expect(log.map((e) => e.kind)).toEqual(['created', 'paused', 'resumed']);
  });

  it('pause is no-op when already paused', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.pauseAssignment(a.id, 'admin');
    await lifecycle.pauseAssignment(a.id, 'admin');
    const log = await events.listForAssignment(a.id);
    expect(log.map((e) => e.kind)).toEqual(['created', 'paused']);
  });
});

describe('lifecycle — extend', () => {
  it('updates endsAt and writes one event with both timestamps', async () => {
    const { events, lifecycle } = build();
    const original = new Date(Date.now() + 60_000);
    const next = new Date(Date.now() + 120_000);
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      endsAt: original,
    });
    const x = await lifecycle.extendAssignment(a.id, next, 'admin');
    expect(x.endsAt?.getTime()).toBe(next.getTime());
    const log = await events.listForAssignment(a.id);
    const last = log[log.length - 1]!;
    expect(last.kind).toBe('extended');
    expect(last.payload.previousEndsAt).toBe(original.toISOString());
    expect(last.payload.newEndsAt).toBe(next.toISOString());
  });

  it('extending to the same endsAt is a no-op', async () => {
    const { events, lifecycle } = build();
    const end = new Date(Date.now() + 60_000);
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      endsAt: end,
    });
    await lifecycle.extendAssignment(a.id, end, 'admin');
    const log = await events.listForAssignment(a.id);
    expect(log).toHaveLength(1);
  });
});

describe('lifecycle — capability + scopeRef mutations', () => {
  it('add / remove capability is idempotent and event-logged', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.addCapability(a.id, 'polygon_edit', 'admin');
    await lifecycle.addCapability(a.id, 'polygon_edit', 'admin'); // no-op
    const after = await lifecycle.removeCapability(a.id, 'view', 'admin');
    expect(after.capabilities).toEqual(['polygon_edit']);
    const log = await events.listForAssignment(a.id);
    expect(log.map((e) => e.kind)).toEqual([
      'created',
      'capability_added',
      'capability_removed',
    ]);
  });

  it('add / remove scopeRef is idempotent and event-logged', async () => {
    const { events, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.addScopeRef(a.id, 'p2', 'admin');
    await lifecycle.addScopeRef(a.id, 'p2', 'admin'); // no-op
    const after = await lifecycle.removeScopeRef(a.id, 'p1', 'admin');
    expect(after.scopeRefs).toEqual(['p2']);
    const log = await events.listForAssignment(a.id);
    expect(log.map((e) => e.kind)).toEqual([
      'created',
      'scope_ref_added',
      'scope_ref_removed',
    ]);
  });
});

describe('lifecycle — bulk', () => {
  it('writes all rows when none duplicate', async () => {
    const { lifecycle } = build();
    const out = await lifecycle.bulkAssign([
      {
        userId: 'u1',
        tenantId: T,
        scope: 'parcel',
        scopeRefs: ['p1'],
        capabilities: ['view'],
        assignedBy: 'admin',
      },
      {
        userId: 'u2',
        tenantId: T,
        scope: 'parcel',
        scopeRefs: ['p2'],
        capabilities: ['view'],
        assignedBy: 'admin',
      },
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.id)).size).toBe(2);
  });

  it('dedupes duplicates within the batch', async () => {
    const { lifecycle } = build();
    const out = await lifecycle.bulkAssign([
      {
        userId: 'u1',
        tenantId: T,
        scope: 'parcel',
        scopeRefs: ['p1'],
        capabilities: ['view'],
        assignedBy: 'admin',
      },
      {
        userId: 'u1',
        tenantId: T,
        scope: 'parcel',
        scopeRefs: ['p1'],
        capabilities: ['view'],
        assignedBy: 'admin',
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe(out[1]!.id);
  });
});

describe('lifecycle — frozen output', () => {
  it('returned assignments are frozen', async () => {
    const { lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.scopeRefs)).toBe(true);
    expect(Object.isFrozen(a.capabilities)).toBe(true);
  });
});
