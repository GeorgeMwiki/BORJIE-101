import { describe, it, expect } from 'vitest';
import { buildLegibilitySnapshot } from '../builder/snapshot-builder.js';
import {
  LegibilityQueryError,
  projectSnapshot,
  runLegibilityQuery,
} from '../queries/query-runner.js';
import { createInMemorySnapshotRepository } from '../repositories/snapshot.js';
import type { BuilderDeps, InternalCallerCtx } from '../types.js';

function deps(): BuilderDeps {
  return {
    orgScope: {
      listPeopleInScope: async () => [
        { personId: 'owner-1', displayName: 'Mwikila', primaryRole: 'owner' },
        { personId: 'worker-1', displayName: 'Juma', primaryRole: 'worker' },
        { personId: 'cust-1', displayName: 'Asha', primaryRole: 'customer' },
      ],
      listRolesInScope: async () => [
        {
          personId: 'owner-1',
          role: 'owner',
          scopeId: 'kahama/mine-088',
          since: '2025-01-01T00:00:00.000Z',
        },
        {
          personId: 'worker-1',
          role: 'worker',
          scopeId: 'kahama/mine-088',
          since: '2026-01-01T00:00:00.000Z',
        },
        {
          personId: 'cust-1',
          role: 'customer',
          scopeId: 'kahama/mine-088',
          since: '2026-01-01T00:00:00.000Z',
        },
      ],
      listScopeSubtree: async () => [
        {
          scopeId: 'kahama/mine-088',
          kind: 'mine',
          parentScopeId: 'kahama',
          displayName: 'KAH-088',
        },
      ],
    },
    capability: {
      listLiveCapabilities: async () => [
        {
          capabilityId: 'kyb_run',
          version: 7,
          owner: null,
          status: 'live' as const,
        },
        {
          capabilityId: 'tumemadini_filing',
          version: 3,
          owner: null,
          status: 'live' as const,
        },
      ],
    },
    work: {
      listCurrentWork: async () => [
        {
          subject: { kind: 'mine', id: 'KAH-088' },
          kind: 'safety_audit',
          owner: 'owner-1',
          startedAt: '2026-05-26T00:00:00.000Z',
          blocker: null,
        },
        {
          subject: { kind: 'mine', id: 'KAH-091' },
          kind: 'kyb_run',
          owner: 'owner-1',
          startedAt: '2026-05-25T00:00:00.000Z',
          blocker: 'awaiting_signature',
        },
      ],
    },
    junior: {
      listAssignments: async () => [
        {
          juniorId: 'junior-safety',
          subject: { kind: 'mine', id: 'KAH-088' },
          scopeId: 'kahama/mine-088',
          capabilityId: 'safety_audit',
          assignedAt: '2026-05-26T00:00:00.000Z',
        },
      ],
      listRoutes: async () => [],
    },
    now: () => new Date(1_700_000_000_000),
  };
}

describe('query-runner', () => {
  it('filters people by role', async () => {
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088' },
      deps(),
    );
    const result = projectSnapshot(snap, {
      tenantId: 't1',
      scopeId: 'kahama/mine-088',
      axes: ['people', 'roles'],
      filter: { role: 'owner' },
    });
    expect(result.people.length).toBe(1);
    expect(result.people[0]?.personId).toBe('owner-1');
    expect(result.roles.length).toBe(1);
    expect(result.roles[0]?.role).toBe('owner');
  });

  it('filters work by activeOnly=true', async () => {
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088' },
      deps(),
    );
    const result = projectSnapshot(snap, {
      tenantId: 't1',
      scopeId: 'kahama/mine-088',
      axes: ['currentWork'],
      filter: { activeOnly: true },
    });
    expect(result.currentWork.length).toBe(1);
    expect(result.currentWork[0]?.subject.id).toBe('KAH-088');
  });

  it('strips juniors axis when no internal token is presented', async () => {
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088', includeInternal: true },
      deps(),
    );
    const result = projectSnapshot(snap, {
      tenantId: 't1',
      scopeId: 'kahama/mine-088',
    });
    expect(result.juniors.length).toBe(0);
    expect(result.juniorRoutes.length).toBe(0);
  });

  it('returns juniors axis when internal token is presented', async () => {
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088', includeInternal: true },
      deps(),
    );
    const internal: InternalCallerCtx = {
      elevated: true,
      callerId: 'mr-mwikila',
    };
    const result = projectSnapshot(snap, {
      tenantId: 't1',
      scopeId: 'kahama/mine-088',
      internal,
    });
    expect(result.juniors.length).toBe(1);
    expect(result.juniors[0]?.juniorId).toBe('junior-safety');
  });

  it('runLegibilityQuery raises snapshot_missing when no snapshot exists', async () => {
    const snapshots = createInMemorySnapshotRepository();
    await expect(
      runLegibilityQuery(
        { tenantId: 'tX', scopeId: 'unknown' },
        { snapshots },
      ),
    ).rejects.toBeInstanceOf(LegibilityQueryError);
  });

  it('runLegibilityQuery returns the latest snapshot for the scope', async () => {
    const snapshots = createInMemorySnapshotRepository();
    const snap = await buildLegibilitySnapshot(
      { tenantId: 't1', scopeId: 'kahama/mine-088' },
      deps(),
    );
    await snapshots.insert(snap);
    const result = await runLegibilityQuery(
      { tenantId: 't1', scopeId: 'kahama/mine-088', axes: ['scopes'] },
      { snapshots },
    );
    expect(result.scopes.length).toBe(1);
    expect(result.scopes[0]?.scopeId).toBe('kahama/mine-088');
  });
});
