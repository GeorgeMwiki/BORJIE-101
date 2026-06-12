/**
 * Audience fan-out (SC-6) — the (scope, audience) → N per-recipient
 * expander over the membership graph + the new classified topic
 * granularities (identity / org-audience) on the cross-portal bus.
 */

import { describe, it, expect } from 'vitest';

import {
  audienceTopic,
  identityTopic,
  createAudienceFanout,
  type AudienceFanout,
} from '../audience-fanout';

interface Published {
  topic: string;
  event: { kind: string; payload: Record<string, unknown>; emittedBy: string };
}

function harness(
  members: Array<{ tenantIdentityId: string }>,
  opts?: { failResolve?: boolean },
): { fanout: AudienceFanout; published: Published[] } {
  const published: Published[] = [];
  const fanout = createAudienceFanout({
    membershipResolver: {
      resolveAudience: async () => {
        if (opts?.failResolve) throw new Error('boom');
        return members;
      },
    },
    crossPortalBus: Promise.resolve({
      publish: async (topic: string, event: never) => {
        published.push({ topic, event });
      },
      subscribe: async () => async () => undefined,
      close: async () => undefined,
    } as never),
    clock: () => new Date('2026-06-11T12:00:00Z'),
  });
  return { fanout, published };
}

describe('topic builders', () => {
  it('sanitize their inputs and namespace per granularity', () => {
    expect(identityTopic('tid_abc-1')).toBe(
      'borjie:cross-portal:identity:tid_abc-1:event',
    );
    expect(audienceTopic('org_1', 'rel-buyer_connection')).toBe(
      'borjie:cross-portal:org:org_1:audience:rel-buyer_connection:event',
    );
    // Injection attempts are stripped, never namespaced.
    expect(identityTopic('tid:*]evil')).toBe(
      'borjie:cross-portal:identity:tidevil:event',
    );
    expect(() => identityTopic(':::')).toThrow(/sanitisation/);
  });
});

describe('publishToAudience', () => {
  it('fans one publish per UNIQUE recipient identity + the audience topic', async () => {
    const { fanout, published } = harness([
      { tenantIdentityId: 'tid_a' },
      { tenantIdentityId: 'tid_b' },
      { tenantIdentityId: 'tid_a' }, // duplicate — one publish only
    ]);
    const count = await fanout.publishToAudience({
      organizationId: 'org_1',
      audience: { relationshipType: 'buyer_connection' },
      kind: 'notification',
      payload: { type: 'price-update' },
      emittedBy: 'test',
    });
    expect(count).toBe(2);
    const topics = published.map((p) => p.topic).sort();
    expect(topics).toEqual([
      'borjie:cross-portal:identity:tid_a:event',
      'borjie:cross-portal:identity:tid_b:event',
      'borjie:cross-portal:org:org_1:audience:rel-buyer_connection:event',
    ]);
    expect(published[0]?.event.payload).toEqual({ type: 'price-update' });
  });

  it('role-class audiences key the audience topic deterministically', async () => {
    const { fanout, published } = harness([{ tenantIdentityId: 'tid_w1' }]);
    await fanout.publishToAudience({
      organizationId: 'org_1',
      audience: { memberRoles: ['safety_officer', 'driller'] },
      kind: 'wake-trigger',
      payload: {},
      emittedBy: 'test',
    });
    expect(published.map((p) => p.topic)).toContain(
      'borjie:cross-portal:org:org_1:audience:role-driller-safety_officer:event',
    );
  });

  it('resolution failure → 0 recipients, no publish, no throw (best-effort)', async () => {
    const { fanout, published } = harness([], { failResolve: true });
    const count = await fanout.publishToAudience({
      organizationId: 'org_1',
      audience: {},
      kind: 'notification',
      payload: {},
      emittedBy: 'test',
    });
    expect(count).toBe(0);
    expect(published).toHaveLength(0);
  });
});

describe('publishToIdentity', () => {
  it('publishes the single-recipient leg', async () => {
    const { fanout, published } = harness([]);
    await fanout.publishToIdentity({
      tenantIdentityId: 'tid_x',
      kind: 'notification',
      payload: { type: 'membership-approved' },
      emittedBy: 'memberships:approve',
    });
    expect(published).toHaveLength(1);
    expect(published[0]?.topic).toBe(
      'borjie:cross-portal:identity:tid_x:event',
    );
    expect(published[0]?.event.emittedBy).toBe('memberships:approve');
  });
});
