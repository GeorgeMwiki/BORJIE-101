import { describe, it, expect } from 'vitest';
import {
  applyInternalDelta,
  applyPublicDelta,
  DeltaApplyError,
} from '../builder/delta-applier.js';
import { computeLegibilityAuditHash } from '../audit/audit-chain-link.js';
import type {
  InternalLegibilityMap,
  LegibilityDelta,
  PublicLegibilityMap,
} from '../types.js';

function emptyMap(): PublicLegibilityMap {
  return {
    tenantId: 't1',
    scopeId: 'tenant_root',
    assembledAt: new Date(0).toISOString(),
    people: [],
    roles: [],
    scopes: [],
    capabilities: [],
    currentWork: [],
    auditHash: computeLegibilityAuditHash({ op: 'initial' }),
  };
}

function buildDelta(
  kind: LegibilityDelta['deltaKind'],
  payload: Record<string, unknown>,
): LegibilityDelta {
  return {
    id: 'd-1',
    tenantId: 't1',
    scopeId: 'tenant_root',
    deltaKind: kind,
    payload,
    recordedAt: new Date(),
    auditHash: 'x',
  };
}

describe('delta-applier', () => {
  it('applies person.added and increments people axis', () => {
    const map = emptyMap();
    const next = applyPublicDelta(
      map,
      buildDelta('person.added', {
        personId: 'p1',
        displayName: 'Mwikila',
        primaryRole: 'owner',
      }),
      new Date(),
    );
    expect(next.people.length).toBe(1);
    expect(next.people[0]?.personId).toBe('p1');
    expect(next.auditHash).not.toEqual(map.auditHash);
  });

  it('applies role.granted then role.revoked symmetrically', () => {
    const map = emptyMap();
    const granted = applyPublicDelta(
      map,
      buildDelta('role.granted', {
        personId: 'p1',
        role: 'manager',
        scopeId: 'tabora',
        since: '2026-01-01T00:00:00.000Z',
      }),
      new Date(),
    );
    expect(granted.roles.length).toBe(1);
    const revoked = applyPublicDelta(
      granted,
      buildDelta('role.revoked', {
        personId: 'p1',
        role: 'manager',
        scopeId: 'tabora',
      }),
      new Date(),
    );
    expect(revoked.roles.length).toBe(0);
  });

  it('rejects junior.assigned on the public path', () => {
    const map = emptyMap();
    expect(() =>
      applyPublicDelta(
        map,
        buildDelta('junior.assigned', { juniorId: 'j-1' }),
        new Date(),
      ),
    ).toThrow(DeltaApplyError);
  });

  it('routes junior.assigned through the internal path', () => {
    const internal: InternalLegibilityMap = {
      ...emptyMap(),
      juniors: [],
      juniorRoutes: [],
    };
    const next = applyInternalDelta(
      internal,
      buildDelta('junior.assigned', {
        juniorId: 'j-1',
        capabilityId: 'safety_audit',
        scopeId: 'kahama/mine-088',
        subject: { kind: 'mine', id: 'KAH-088' },
        assignedAt: '2026-05-26T00:00:00.000Z',
      }),
      new Date(),
    );
    expect(next.juniors.length).toBe(1);
    expect(next.juniors[0]?.juniorId).toBe('j-1');
  });

  it('throws DeltaApplyError on malformed person.added payload', () => {
    const map = emptyMap();
    expect(() =>
      applyPublicDelta(
        map,
        buildDelta('person.added', { displayName: 'no id' }),
        new Date(),
      ),
    ).toThrow(DeltaApplyError);
  });

  it('work.blocked annotates an existing work item without removing it', () => {
    let map = emptyMap();
    map = applyPublicDelta(
      map,
      buildDelta('work.started', {
        subject: { kind: 'mine', id: 'KAH-088' },
        kind: 'safety_audit',
        owner: 'p1',
        startedAt: '2026-05-26T00:00:00.000Z',
      }),
      new Date(),
    );
    expect(map.currentWork.length).toBe(1);
    map = applyPublicDelta(
      map,
      buildDelta('work.blocked', {
        subject: { kind: 'mine', id: 'KAH-088' },
        blocker: 'awaiting_owner_signature',
      }),
      new Date(),
    );
    expect(map.currentWork.length).toBe(1);
    expect(map.currentWork[0]?.blocker).toBe('awaiting_owner_signature');
  });
});
