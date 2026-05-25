/**
 * Scope guard tests — covers direct/cascade/deny paths + edge cases.
 *
 * The guard is the security floor; bugs here are CRITICAL. Each test is
 * isolated (its own repo + guard instance) so a leak between tests is
 * structurally impossible.
 */

import { describe, expect, it } from 'vitest';
import {
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
  createLifecycleManager,
  createScopeGuard,
  createIdGen,
  DEFAULT_CASCADE_RULES,
  type Assignment,
  type AssignmentRepository,
  type Capability,
  type ScopeKind,
} from '../index.js';

function build(): {
  repo: AssignmentRepository;
  events: ReturnType<typeof createInMemoryAssignmentEventRepository>;
  lifecycle: ReturnType<typeof createLifecycleManager>;
} {
  const repo = createInMemoryAssignmentRepository();
  const events = createInMemoryAssignmentEventRepository();
  const lifecycle = createLifecycleManager({
    assignmentRepository: repo,
    eventRepository: events,
    idGen: createIdGen(),
  });
  return { repo, events, lifecycle };
}

const T = 'tenant-trc';

describe('scope guard — default deny', () => {
  it('denies when the user has no assignments at all', async () => {
    const { repo } = build();
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'user-1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-1',
    });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('no_active_assignments');
    expect(r.matchedAssignmentId).toBeNull();
  });

  it('denies when assignment lacks the required capability', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'user-1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['parcel-1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'user-1',
      tenantId: T,
      action: 'polygon_edit',
      scope: 'parcel',
      scopeRef: 'parcel-1',
    });
    expect(r.decision).toBe('deny');
  });

  it('denies when scopeRef is outside the assignment', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'user-1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['parcel-1', 'parcel-2'],
      capabilities: ['view', 'polygon_edit'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'user-1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-999',
    });
    expect(r.decision).toBe('deny');
  });

  it('denies when assignment is paused', async () => {
    const { repo, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.pauseAssignment(a.id, 'admin');
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(r.decision).toBe('deny');
  });

  it('denies when assignment is revoked', async () => {
    const { repo, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    await lifecycle.revokeAssignment(a.id, 'admin');
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(r.decision).toBe('deny');
  });

  it('denies when the assignment is in the future (startsAt > now)', async () => {
    const { repo, lifecycle } = build();
    const future = new Date(Date.now() + 60_000);
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      startsAt: future,
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(r.decision).toBe('deny');
  });

  it('denies when the assignment has expired (endsAt <= now)', async () => {
    const { repo, lifecycle } = build();
    const past = new Date(Date.now() - 60_000);
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
      startsAt: new Date(Date.now() - 120_000),
      endsAt: past,
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(r.decision).toBe('deny');
  });
});

describe('scope guard — direct allow', () => {
  it('allows when the assignment matches scope+ref+capability', async () => {
    const { repo, lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1', 'p2'],
      capabilities: ['view', 'polygon_edit'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'polygon_edit',
      scope: 'parcel',
      scopeRef: 'p2',
    });
    expect(r.decision).toBe('allow');
    expect(r.reason).toBe('direct_assignment');
    expect(r.matchedAssignmentId).toBe(a.id);
  });

  it('treats empty scopeRefs as scope-wide grant', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: [],
      capabilities: ['view', 'assign_others'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'district',
      scopeRef: 'district-anything',
    });
    expect(r.decision).toBe('allow');
  });
});

describe('scope guard — parent cascade', () => {
  it('cascades view from district → parcel (default rules)', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: ['district-1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [{ scope: 'district', scopeRef: 'district-1' }],
    });
    expect(r.decision).toBe('allow');
    expect(r.reason).toBe('cascade_assignment');
  });

  it('does NOT cascade polygon_edit (write capability)', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: ['district-1'],
      capabilities: ['polygon_edit'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'polygon_edit',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [{ scope: 'district', scopeRef: 'district-1' }],
    });
    expect(r.decision).toBe('deny');
  });

  it('respects custom cascade rules — write capabilities can be opted-in', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: ['district-1'],
      capabilities: ['polygon_edit'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({
      assignmentRepository: repo,
      // Override takes precedence — must come FIRST in the rules array
      // because `cascadeRules.find` returns the first matching parent→
      // child edge. DEFAULT_CASCADE_RULES is appended only to keep the
      // other edges (region→district etc.) active.
      cascadeRules: [
        {
          parentScope: 'district',
          childScope: 'parcel',
          cascadedCapabilities: ['polygon_edit'],
        },
        ...DEFAULT_CASCADE_RULES.filter(
          (r) => !(r.parentScope === 'district' && r.childScope === 'parcel'),
        ),
      ],
    });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'polygon_edit',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [{ scope: 'district', scopeRef: 'district-1' }],
    });
    expect(r.decision).toBe('allow');
  });

  it('cascade ignores parent the assignment does not cover', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: ['district-1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [{ scope: 'district', scopeRef: 'district-OTHER' }],
    });
    expect(r.decision).toBe('deny');
  });

  it('cascade walks multiple parents (region → district → parcel)', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'region',
      scopeRefs: ['region-A'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [
        { scope: 'district', scopeRef: 'district-1' },
        { scope: 'region', scopeRef: 'region-A' },
      ],
    });
    expect(r.decision).toBe('allow');
  });
});

describe('scope guard — per-request cache', () => {
  it('hits the cache on repeated calls for the same (tenant,user)', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    let reads = 0;
    const tracking: AssignmentRepository = {
      insert: repo.insert.bind(repo),
      update: repo.update.bind(repo),
      findById: repo.findById.bind(repo),
      list: repo.list.bind(repo),
      findByScope: repo.findByScope.bind(repo),
      async findByAssignee(tenantId, userId) {
        reads += 1;
        return repo.findByAssignee(tenantId, userId);
      },
    };
    const guard = createScopeGuard({ assignmentRepository: tracking });
    await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(reads).toBe(1);
    guard.reset();
    await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(reads).toBe(2);
  });
});

describe('scope guard — tenant isolation', () => {
  it('a user authorised in tenant A is denied in tenant B', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: 'tenant-A',
      scope: 'parcel',
      scopeRefs: ['p1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const ok = await guard.check({
      userId: 'u1',
      tenantId: 'tenant-A',
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(ok.decision).toBe('allow');
    const cross = await guard.check({
      userId: 'u1',
      tenantId: 'tenant-B',
      action: 'view',
      scope: 'parcel',
      scopeRef: 'p1',
    });
    expect(cross.decision).toBe('deny');
  });
});

describe('scope guard — direct match wins over cascade', () => {
  it('returns direct when both direct and cascade match', async () => {
    const { repo, lifecycle } = build();
    await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'district',
      scopeRefs: ['district-1'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const direct = await lifecycle.assignUser({
      userId: 'u1',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['parcel-99'],
      capabilities: ['view'],
      assignedBy: 'admin',
    });
    const guard = createScopeGuard({ assignmentRepository: repo });
    const r = await guard.check({
      userId: 'u1',
      tenantId: T,
      action: 'view',
      scope: 'parcel',
      scopeRef: 'parcel-99',
      parentChain: [{ scope: 'district', scopeRef: 'district-1' }],
    });
    expect(r.reason).toBe('direct_assignment');
    expect(r.matchedAssignmentId).toBe(direct.id);
  });
});

describe('scope kinds + capability vocabulary', () => {
  it('every canonical scope kind is usable', async () => {
    const scopes: ScopeKind[] = [
      'parcel',
      'area',
      'property',
      'district',
      'region',
      'station',
      'tender',
      'po',
      'requisition',
      'maintenance_job',
      'inspection',
      'document',
      'lease',
      'unit',
      'building',
    ];
    const { repo, lifecycle } = build();
    for (const s of scopes) {
      const a: Assignment = await lifecycle.assignUser({
        userId: `u-${s}`,
        tenantId: T,
        scope: s,
        scopeRefs: ['ref-1'],
        capabilities: ['view'],
        assignedBy: 'admin',
      });
      expect(a.scope).toBe(s);
    }
    const guard = createScopeGuard({ assignmentRepository: repo });
    for (const s of scopes) {
      const r = await guard.check({
        userId: `u-${s}`,
        tenantId: T,
        action: 'view',
        scope: s,
        scopeRef: 'ref-1',
      });
      expect(r.decision).toBe('allow');
    }
  });

  it('every capability is usable in an assignment', async () => {
    const caps: Capability[] = [
      'view',
      'annotate',
      'comment',
      'polygon_edit',
      'metadata_edit',
      'photo_add',
      'video_add',
      'document_upload',
      'inspection_complete',
      'maintenance_complete',
      'lease_draft',
      'submit_for_review',
      'approve_change',
      'reject_change',
      'assign_others',
      'revoke_assignment',
    ];
    const { lifecycle } = build();
    const a = await lifecycle.assignUser({
      userId: 'u-all',
      tenantId: T,
      scope: 'parcel',
      scopeRefs: ['ref-1'],
      capabilities: caps,
      assignedBy: 'admin',
    });
    expect(a.capabilities).toHaveLength(caps.length);
  });
});
