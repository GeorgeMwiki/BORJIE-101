import { describe, it, expect } from 'vitest';
import { buildLegibilitySnapshot } from '../builder/snapshot-builder.js';
import type {
  BuilderDeps,
  CapabilityRef,
  JuniorAssignment,
  JuniorRouteEdge,
  PersonNode,
  RoleEdge,
  ScopeNode,
  WorkItem,
} from '../types.js';

function buildDeps(
  overrides?: Partial<{
    people: PersonNode[];
    roles: RoleEdge[];
    scopes: ScopeNode[];
    caps: CapabilityRef[];
    work: WorkItem[];
    juniors: JuniorAssignment[];
    routes: JuniorRouteEdge[];
    now: Date;
  }>,
): BuilderDeps {
  const o = overrides ?? {};
  return {
    orgScope: {
      listPeopleInScope: async () => o.people ?? [],
      listRolesInScope: async () => o.roles ?? [],
      listScopeSubtree: async () => o.scopes ?? [],
    },
    capability: {
      listLiveCapabilities: async () => o.caps ?? [],
    },
    work: {
      listCurrentWork: async () => o.work ?? [],
    },
    junior: {
      listAssignments: async () => o.juniors ?? [],
      listRoutes: async () => o.routes ?? [],
    },
    now: () => o.now ?? new Date(1_700_000_000_000),
  };
}

describe('snapshot-builder', () => {
  it('assembles a public snapshot from the readers', async () => {
    const deps = buildDeps({
      people: [{ personId: 'p1', displayName: 'Mwikila', primaryRole: 'owner' }],
      roles: [
        {
          personId: 'p1',
          role: 'owner',
          scopeId: 'kahama/mine-088',
          since: '2025-01-01T00:00:00.000Z',
        },
      ],
      caps: [
        {
          capabilityId: 'kyb_run',
          version: 7,
          owner: null,
          status: 'live',
        },
      ],
    });
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088' },
      deps,
    );
    expect(snap.snapshot.people.length).toBe(1);
    expect(snap.snapshot.roles[0]?.role).toBe('owner');
    expect(snap.snapshot.capabilities[0]?.capabilityId).toBe('kyb_run');
    expect(snap.internalSnapshot).toBeNull();
  });

  it('omits internal snapshot unless includeInternal=true', async () => {
    const deps = buildDeps({
      juniors: [
        {
          juniorId: 'j-1',
          subject: { kind: 'mine', id: 'KAH-088' },
          scopeId: 'kahama/mine-088',
          capabilityId: 'safety_audit',
          assignedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088' },
      deps,
    );
    expect(snap.internalSnapshot).toBeNull();
  });

  it('builds internal snapshot with juniors when requested', async () => {
    const deps = buildDeps({
      juniors: [
        {
          juniorId: 'j-1',
          subject: { kind: 'mine', id: 'KAH-088' },
          scopeId: 'kahama/mine-088',
          capabilityId: 'safety_audit',
          assignedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088', includeInternal: true },
      deps,
    );
    expect(snap.internalSnapshot).not.toBeNull();
    expect(snap.internalSnapshot?.juniors[0]?.juniorId).toBe('j-1');
  });

  it('produces a deterministic audit hash for identical inputs', async () => {
    const deps = buildDeps({
      people: [{ personId: 'p1', displayName: 'Mwikila', primaryRole: 'owner' }],
    });
    const a = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'tenant_root' },
      deps,
    );
    const b = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'tenant_root' },
      deps,
    );
    // The same canonical content produces the same public-map audit hash.
    expect(a.snapshot.auditHash).toEqual(b.snapshot.auditHash);
  });

  it('respects the axes subset', async () => {
    let peopleCalled = false;
    let workCalled = false;
    const deps: BuilderDeps = {
      orgScope: {
        listPeopleInScope: async () => {
          peopleCalled = true;
          return [];
        },
        listRolesInScope: async () => [],
        listScopeSubtree: async () => [],
      },
      capability: { listLiveCapabilities: async () => [] },
      work: {
        listCurrentWork: async () => {
          workCalled = true;
          return [];
        },
      },
      now: () => new Date(),
    };
    await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'tenant_root', axes: ['scopes'] },
      deps,
    );
    expect(peopleCalled).toBe(false);
    expect(workCalled).toBe(false);
  });
});
