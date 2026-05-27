/**
 * Tests for the outcome-observer cron worker.
 *
 * The observer must:
 *   - pick up only rows older than `horizonMs`.
 *   - attach the resolved observation to the audit row.
 *   - forward a fresh `Outcome` to the catalogue `OutcomeRepository`.
 *   - skip rows whose feed returns `null` (horizon not reached).
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryOutcomeRepository } from '@borjie/capability-catalogue';
import {
  createInMemoryIntelInvocationAuditRepository,
  emitTelemetry,
  runOutcomeObserverTick,
  type OutcomeFeedPort,
} from '../index.js';
import {
  createDeterministicClock,
  createSequentialIdGen,
  createTestLogger,
  TEST_CAPABILITY_ID,
  TEST_TENANT,
} from '../__fixtures__/test-doubles.js';
import { createInMemoryInvocationRepository } from '@borjie/capability-catalogue';
import { createInMemoryIntelSkillTracesRepository } from '../index.js';

describe('runOutcomeObserverTick', () => {
  it('attaches ground truth to rows older than horizonMs', async () => {
    const auditRepo = createInMemoryIntelInvocationAuditRepository();
    const outcomeRepo = createInMemoryOutcomeRepository();
    const catalogueRepo = createInMemoryInvocationRepository();
    const skillRepo = createInMemoryIntelSkillTracesRepository();
    const logger = createTestLogger();
    const clock = createDeterministicClock('2026-05-27T08:00:00.000Z');
    const idGen = createSequentialIdGen();

    const capability = {
      capabilityId: TEST_CAPABILITY_ID,
      tenantId: TEST_TENANT,
      intelKind: 'forecast' as const,
      claimedConfidenceFrom: () => 0.85,
      hashInput: (i: { day: number }) => ({ day: i.day }),
      hashOutput: () => ({ point: 1842 }),
    };

    // Emit two pending invocations 24h apart.
    await emitTelemetry({
      capability,
      deps: {
        invocationAuditRepo: auditRepo,
        catalogueInvocationRepo: catalogueRepo,
        skillTracesRepo: skillRepo,
        logger,
      },
      idGen,
      invocationId: idGen.next(),
      invokedAt: new Date('2026-05-26T08:00:00.000Z'),
      inputPayload: { day: 1 },
      outputPayload: { point: 1842 },
      claimedConfidence: 0.85,
      latencyMs: 5,
      costUsdCents: 1,
    });
    await emitTelemetry({
      capability,
      deps: {
        invocationAuditRepo: auditRepo,
        catalogueInvocationRepo: catalogueRepo,
        skillTracesRepo: skillRepo,
        logger,
      },
      idGen,
      invocationId: idGen.next(),
      invokedAt: new Date('2026-05-27T07:59:59.000Z'),
      inputPayload: { day: 2 },
      outputPayload: { point: 1855 },
      claimedConfidence: 0.85,
      latencyMs: 5,
      costUsdCents: 1,
    });

    const feed: OutcomeFeedPort = {
      async resolve(row) {
        // Resolve only the older row; signal "horizon not reached" for newer.
        const input = row.inputPayload['day'];
        if (input === 1) {
          return {
            observedOutcome: 'confirmed',
            userFollowthrough: 'accepted',
            observationPayload: { observed: 1840 },
          };
        }
        return null;
      },
    };

    const result = await runOutcomeObserverTick(
      {
        tenantId: TEST_TENANT,
        intelKind: 'forecast',
        horizonMs: 60 * 60 * 1000, // 1 hour
        batchSize: 10,
      },
      {
        auditRepo,
        outcomeRepo,
        feed,
        logger,
        clock,
        idGen,
      },
    );

    // Only the row older than the 1h horizon is fed; the newer one is
    // filtered out by `listPendingObservations` before reaching `feed`.
    expect(result.attached).toBe(1);
    expect(result.skipped).toBe(0);
    // Observed window range should now include the attached row.
    const observed = await auditRepo.listObservedInWindow({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      from: '2026-05-26T00:00:00.000Z',
      to: '2026-05-27T00:00:00.000Z',
    });
    expect(observed.length).toBe(1);
    expect(observed[0]?.observedOutcome).toBe('confirmed');
    expect(observed[0]?.userFollowthrough).toBe('accepted');
    // Verify catalogue outcome repo received a row.
    const outcomes = await outcomeRepo.listForInvocations({
      invocationIds: [observed[0]!.id],
    });
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.observedOutcome).toBe('confirmed');
  });

  it('counts feed `null` returns as skipped (horizon not yet reached)', async () => {
    const auditRepo = createInMemoryIntelInvocationAuditRepository();
    const outcomeRepo = createInMemoryOutcomeRepository();
    const catalogueRepo = createInMemoryInvocationRepository();
    const skillRepo = createInMemoryIntelSkillTracesRepository();
    const logger = createTestLogger();
    const clock = createDeterministicClock('2026-05-27T08:00:00.000Z');
    const idGen = createSequentialIdGen();

    const capability = {
      capabilityId: TEST_CAPABILITY_ID,
      tenantId: TEST_TENANT,
      intelKind: 'anomaly' as const,
      claimedConfidenceFrom: () => 0.7,
      hashInput: (i: { id: string }) => ({ id: i.id }),
      hashOutput: () => ({ flagged: true }),
    };

    await emitTelemetry({
      capability,
      deps: {
        invocationAuditRepo: auditRepo,
        catalogueInvocationRepo: catalogueRepo,
        skillTracesRepo: skillRepo,
        logger,
      },
      idGen,
      invocationId: idGen.next(),
      invokedAt: new Date('2026-05-26T08:00:00.000Z'),
      inputPayload: { id: 'incident-1' },
      outputPayload: { flagged: true },
      claimedConfidence: 0.7,
      latencyMs: 4,
      costUsdCents: 1,
    });

    const feed: OutcomeFeedPort = {
      async resolve() {
        return null; // horizon not reached.
      },
    };

    const result = await runOutcomeObserverTick(
      {
        tenantId: TEST_TENANT,
        intelKind: 'anomaly',
        horizonMs: 60 * 60 * 1000,
        batchSize: 10,
      },
      {
        auditRepo,
        outcomeRepo,
        feed,
        logger,
        clock,
        idGen,
      },
    );

    expect(result.attached).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
