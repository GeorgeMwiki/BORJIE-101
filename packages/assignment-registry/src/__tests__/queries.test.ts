/**
 * Read-side query tests — myAssignments, whoCanWorkOn, expiringSoon,
 * unassignedScopeRefs. Each test wires its own repo + lifecycle so
 * cross-pollution between specs is impossible.
 */

import { describe, expect, it } from 'vitest';
import {
  createAssignmentQueryApi,
  createIdGen,
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
  createLifecycleManager,
} from '../index.js';

const T = 'tenant-1';

function build() {
  const repo = createInMemoryAssignmentRepository();
  const events = createInMemoryAssignmentEventRepository();
  const lifecycle = createLifecycleManager({
    assignmentRepository: repo,
    eventRepository: events,
    idGen: createIdGen(),
  });
  const queries = createAssignmentQueryApi({ assignmentRepository: repo });
  return { repo, lifecycle, queries };
}

describe('myAssignments', () => {
  it('returns only active assignments for the user', async () => {
    const { lifecycle, queries } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const b = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p2'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.revokeAssignment(b.id, 'admin');
    // Different user — must NOT leak.
    await lifecycle.assignUser({
      userId: 'u2',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p9'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const out = await queries.myAssignments(T, 'u1');
    expect(out.map((x) => x.id)).toEqual([a.id]);
  });

  it('filters out future-dated and expired assignments', async () => {
    const { lifecycle, queries } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p-future'],
      capabilities: ['view'],
      assignedBy: 'admin',
      startsAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p-expired'],
      capabilities: ['view'],
      assignedBy: 'admin',
      startsAt: new Date(Date.now() - 120_000),
      endsAt: new Date(Date.now() - 60_000),
    });
    const active = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p-active'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const out = await queries.myAssignments(T, 'u1');
    expect(out.map((x) => x.id)).toEqual([active.id]);
  });
});

describe('whoCanWorkOn', () => {
  it('returns every user with the requested capability on the ref', async () => {
    const { lifecycle, queries } = build();
    const a1 = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['polygon_edit'],
      assignedBy: 'admin',
    });
    const a2 = await lifecycle.assignUser({
      userId: 'u2',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1', 'p2'],
      capabilities: ['polygon_edit', 'view'],
      assignedBy: 'admin',
    });
    // Wrong capability — must NOT show up.
    await lifecycle.assignUser({
      userId: 'u3',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const out = await queries.whoCanWorkOn(T, 'parcel', 'p1', 'polygon_edit');
    expect(out.map((x) => x.id).sort()).toEqual([a1.id, a2.id].sort());
  });

  it('returns empty array when no one has the capability', async () => {
    const { queries } = build();
    const out = await queries.whoCanWorkOn(T, 'parcel', 'p1', 'polygon_edit');
    expect(out).toEqual([]);
  });
});

describe('expiringSoon', () => {
  it('returns assignments whose endsAt is within the window', async () => {
    const { lifecycle, queries } = build();
    const soon = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      endsAt: new Date(Date.now() + 30_000),
    });
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p2'],
      capabilities: ['view'],
      assignedBy: 'admin',
      endsAt: new Date(Date.now() + 120_000),
    });
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p3'],
      capabilities: ['view'],
      assignedBy: 'admin',
      // No endsAt — must NOT appear.
    });
    const out = await queries.expiringSoon(T, 60_000);
    expect(out.map((x) => x.id)).toEqual([soon.id]);
  });
});

describe('unassignedScopeRefs', () => {
  it('returns refs not covered by any active assignment', async () => {
    const { lifecycle, queries } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1', 'p2'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const out = await queries.unassignedScopeRefs(T, 'parcel', [
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
    expect([...out].sort()).toEqual(['p3', 'p4']);
  });

  it('treats empty scopeRefs assignment as covering every candidate', async () => {
    const { lifecycle, queries } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: [],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const out = await queries.unassignedScopeRefs(T, 'district', [
      'd1',
      'd2',
      'd3',
    ]);
    expect(out).toEqual([]);
  });
});
