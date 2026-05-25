/**
 * Composed-headline tests — `createAssignmentRegistry` returns scope +
 * management + queries wired against the same shared repos.
 */

import { describe, expect, it } from 'vitest';
import {
  createAssignmentRegistry,
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
} from '../index.js';

describe('createAssignmentRegistry', () => {
  it('wires the three subsystems against one shared repo', async () => {
    const registry = createAssignmentRegistry({
      assignmentRepository: createInMemoryAssignmentRepository(),
      eventRepository: createInMemoryAssignmentEventRepository(),
    });
    const a = await registry.management.assignUser({
      userId: 'u1',
      tenantId: 't1',
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const decision = await registry.scope.check({
      userId: 'u1',
      tenantId: 't1',
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(decision.decision).toBe('allow');
    expect(decision.matchedAssignmentId).toBe(a.id);
    const mine = await registry.queries.myAssignments('t1', 'u1');
    expect(mine.map((x) => x.id)).toEqual([a.id]);
  });

  it('accepts custom cascade rules', async () => {
    const registry = createAssignmentRegistry({
      assignmentRepository: createInMemoryAssignmentRepository(),
      eventRepository: createInMemoryAssignmentEventRepository(),
      cascadeRules: [
        {
          parentScope: 'district',
          childScope: 'parcel',
          cascadedCapabilities: ['polygon_edit'],
        },
      ],
    });
    await registry.management.assignUser({
      userId: 'u1',
      tenantId: 't1',
      scope: 'district',
      scopeRefs: ['d1'],
      capabilities: ['polygon_edit'],
      assignedBy: 'admin',
    });
    const ok = await registry.scope.check({
      userId: 'u1',
      tenantId: 't1',
      action: 'polygon_edit',
      scope: 'parcel',
      scopeRef: 'p99',
      parentChain: [{ scope: 'district', scopeRef: 'd1' }],
    });
    expect(ok.decision).toBe('allow');
    expect(ok.reason).toBe('cascade_assignment');
  });
});
