/**
 * CRUD tests for the two in-memory repositories.
 */

import { describe, expect, it } from 'vitest';
import {
  createInMemoryIntelInvocationAuditRepository,
  createInMemoryIntelSkillTracesRepository,
  patternSignatureFor,
  type IntelInvocationContext,
  type OutcomeObservation,
} from '../index.js';
import { TEST_CAPABILITY_ID, TEST_TENANT } from '../__fixtures__/test-doubles.js';

function buildContext(
  overrides: Partial<IntelInvocationContext> = {},
): IntelInvocationContext {
  const base: IntelInvocationContext = Object.freeze({
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: TEST_TENANT,
    capabilityId: TEST_CAPABILITY_ID,
    intelKind: 'forecast',
    inputPayload: Object.freeze({ target: 'gold_price', horizon: 1 }),
    outputPayload: Object.freeze({ point: 1842 }),
    claimedConfidence: 0.85,
    latencyMs: 12,
    costUsdCents: 5,
    invokedAt: '2026-05-27T08:00:00.000Z',
    prevHash: '',
    auditHash: 'abc123',
  });
  return Object.freeze({ ...base, ...overrides });
}

describe('IntelInvocationAuditRepository (in-memory)', () => {
  it('inserts a row and finds it by id', async () => {
    const repo = createInMemoryIntelInvocationAuditRepository();
    const ctx = buildContext({});
    await repo.insert(ctx);
    const fetched = await repo.findById(ctx.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.tenantId).toBe(TEST_TENANT);
    expect(fetched?.observedOutcome).toBeNull();
  });

  it('attaches observation and surfaces it in the observed window', async () => {
    const repo = createInMemoryIntelInvocationAuditRepository();
    const ctx = buildContext({});
    await repo.insert(ctx);
    const obs: OutcomeObservation = Object.freeze({
      invocationId: ctx.id,
      observedOutcome: 'confirmed',
      userFollowthrough: 'accepted',
      observationPayload: Object.freeze({ observed: 1840 }),
      observedAt: '2026-05-28T08:00:00.000Z',
    });
    await repo.attachObservation(obs);
    const observed = await repo.listObservedInWindow({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      from: '2026-05-27T00:00:00.000Z',
      to: '2026-05-28T00:00:00.000Z',
    });
    expect(observed.length).toBe(1);
    expect(observed[0]?.observedOutcome).toBe('confirmed');
    expect(observed[0]?.userFollowthrough).toBe('accepted');
  });

  it('returns the latest audit hash for the chain head', async () => {
    const repo = createInMemoryIntelInvocationAuditRepository();
    await repo.insert(
      buildContext({
        id: '00000000-0000-0000-0000-000000000001',
        invokedAt: '2026-05-27T08:00:00.000Z',
        auditHash: 'first',
      }),
    );
    await repo.insert(
      buildContext({
        id: '00000000-0000-0000-0000-000000000002',
        invokedAt: '2026-05-27T08:01:00.000Z',
        auditHash: 'second',
      }),
    );
    const latest = await repo.latestAuditHash({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
    });
    expect(latest).toBe('second');
  });

  it('listPendingObservations excludes observed rows', async () => {
    const repo = createInMemoryIntelInvocationAuditRepository();
    await repo.insert(buildContext({}));
    const pendingBefore = await repo.listPendingObservations({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      olderThan: '2026-05-28T00:00:00.000Z',
      limit: 10,
    });
    expect(pendingBefore.length).toBe(1);
    await repo.attachObservation({
      invocationId: pendingBefore[0]!.id,
      observedOutcome: 'confirmed',
      userFollowthrough: 'accepted',
      observationPayload: {},
      observedAt: '2026-05-28T08:00:00.000Z',
    });
    const pendingAfter = await repo.listPendingObservations({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      olderThan: '2026-05-28T00:00:00.000Z',
      limit: 10,
    });
    expect(pendingAfter.length).toBe(0);
  });
});

describe('IntelSkillTracesRepository (in-memory)', () => {
  it('creates a new trace and increments existing counters', async () => {
    const repo = createInMemoryIntelSkillTracesRepository();
    const sig = patternSignatureFor({ target: 'gold_price', horizon: 1 });
    const first = await repo.tick({
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      patternSignature: sig,
      capabilityId: TEST_CAPABILITY_ID,
      success: true,
      seenAt: '2026-05-27T08:00:00.000Z',
    });
    expect(first.successCount).toBe(1);
    expect(first.failureCount).toBe(0);
    expect(first.prevHash).toBe('');

    const second = await repo.tick({
      id: '00000000-0000-0000-0000-000000000002',
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      patternSignature: sig,
      capabilityId: TEST_CAPABILITY_ID,
      success: false,
      seenAt: '2026-05-27T08:01:00.000Z',
    });
    expect(second.successCount).toBe(1);
    expect(second.failureCount).toBe(1);
    expect(second.prevHash).toBe(first.auditHash);
    expect(second.auditHash).not.toBe(first.auditHash);
  });

  it('lists traces filtered by tenant + intel kind', async () => {
    const repo = createInMemoryIntelSkillTracesRepository();
    const sig1 = patternSignatureFor({ target: 'gold_price', horizon: 1 });
    const sig2 = patternSignatureFor({ target: 'production_volume', horizon: 7 });
    await repo.tick({
      id: 'a',
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      patternSignature: sig1,
      capabilityId: TEST_CAPABILITY_ID,
      success: true,
      seenAt: '2026-05-27T08:00:00.000Z',
    });
    await repo.tick({
      id: 'b',
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      patternSignature: sig2,
      capabilityId: TEST_CAPABILITY_ID,
      success: true,
      seenAt: '2026-05-27T08:01:00.000Z',
    });
    const traces = await repo.listByTenantKind({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      limit: 10,
    });
    expect(traces.length).toBe(2);
  });
});
