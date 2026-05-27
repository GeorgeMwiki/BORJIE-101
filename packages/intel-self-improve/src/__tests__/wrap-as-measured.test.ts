/**
 * Tests for the `wrapAsMeasured` higher-order wrapper.
 *
 * Verifies that one call:
 *   - returns the underlying output untouched.
 *   - emits one row into the intel-invocation audit repo.
 *   - emits one row into the catalogue invocation repo.
 *   - ticks the Voyager-style skill-trace counter.
 *   - chains audit hashes from prior rows.
 */

import { describe, expect, it } from 'vitest';
import {
  createInMemoryInvocationRepository,
  type Invocation,
} from '@borjie/capability-catalogue';
import {
  buildMeasuredCapability,
  createInMemoryIntelInvocationAuditRepository,
  createInMemoryIntelSkillTracesRepository,
  emitTelemetry,
  patternSignatureFor,
  wrapAsMeasured,
} from '../index.js';
import {
  createDeterministicClock,
  createSequentialIdGen,
  createTestLogger,
  TEST_CAPABILITY_ID,
  TEST_TENANT,
} from '../__fixtures__/test-doubles.js';

interface ForecastInput {
  readonly target: string;
  readonly horizon: number;
}

interface ForecastOutput {
  readonly point: number;
  readonly confidence: number;
  readonly costCents: number;
}

function buildHarness() {
  const auditRepo = createInMemoryIntelInvocationAuditRepository();
  const catalogueRepo = createInMemoryInvocationRepository();
  const skillRepo = createInMemoryIntelSkillTracesRepository();
  const logger = createTestLogger();
  const clock = createDeterministicClock();
  const idGen = createSequentialIdGen();
  const capability = buildMeasuredCapability<ForecastInput, ForecastOutput>({
    capabilityId: TEST_CAPABILITY_ID,
    tenantId: TEST_TENANT,
    intelKind: 'forecast',
    claimedConfidenceFrom: (o) => o.confidence,
    hashInput: (i) => ({ target: i.target, horizon: i.horizon }),
    hashOutput: (o) => ({ point: o.point, confidence: o.confidence }),
    costCentsFrom: (o) => o.costCents,
  });
  return { auditRepo, catalogueRepo, skillRepo, logger, clock, idGen, capability };
}

describe('wrapAsMeasured', () => {
  it('emits one row into intel_invocation_audit per call', async () => {
    const h = buildHarness();
    const underlying = async (input: ForecastInput): Promise<ForecastOutput> => ({
      point: 1842.5,
      confidence: 0.85,
      costCents: 12,
    });
    const wrapped = wrapAsMeasured(h.capability, underlying, {
      invocationAuditRepo: h.auditRepo,
      catalogueInvocationRepo: h.catalogueRepo,
      skillTracesRepo: h.skillRepo,
      logger: h.logger,
      clock: h.clock,
      idGen: h.idGen,
    });
    const output = await wrapped({ target: 'gold_price', horizon: 1 });
    // Wait one tick so the fire-and-forget telemetry resolves.
    await new Promise((r) => setImmediate(r));
    expect(output).toEqual({ point: 1842.5, confidence: 0.85, costCents: 12 });
    const pending = await h.auditRepo.listPendingObservations({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      olderThan: new Date(Date.now() + 1000).toISOString(),
      limit: 100,
    });
    expect(pending.length).toBe(1);
    const row = pending[0]!;
    expect(row.tenantId).toBe(TEST_TENANT);
    expect(row.capabilityId).toBe(TEST_CAPABILITY_ID);
    expect(row.intelKind).toBe('forecast');
    expect(row.claimedConfidence).toBe(0.85);
    expect(row.costUsdCents).toBe(12);
    expect(row.auditHash.length).toBeGreaterThan(0);
    expect(row.prevHash).toBe('');
  });

  it('chains audit hashes across two sequential calls', async () => {
    const h = buildHarness();
    const underlying = async (): Promise<ForecastOutput> => ({
      point: 100,
      confidence: 0.7,
      costCents: 5,
    });
    // Use emitTelemetry directly so chain ordering is deterministic.
    const first = await emitTelemetry({
      capability: h.capability,
      deps: {
        invocationAuditRepo: h.auditRepo,
        catalogueInvocationRepo: h.catalogueRepo,
        skillTracesRepo: h.skillRepo,
        logger: h.logger,
      },
      idGen: h.idGen,
      invocationId: h.idGen.next(),
      invokedAt: new Date('2026-05-27T08:00:00.000Z'),
      inputPayload: { target: 'gold_price', horizon: 1 },
      outputPayload: { point: 100, confidence: 0.7 },
      claimedConfidence: 0.7,
      latencyMs: 12,
      costUsdCents: 5,
    });
    const second = await emitTelemetry({
      capability: h.capability,
      deps: {
        invocationAuditRepo: h.auditRepo,
        catalogueInvocationRepo: h.catalogueRepo,
        skillTracesRepo: h.skillRepo,
        logger: h.logger,
      },
      idGen: h.idGen,
      invocationId: h.idGen.next(),
      invokedAt: new Date('2026-05-27T08:00:01.000Z'),
      inputPayload: { target: 'gold_price', horizon: 1 },
      outputPayload: { point: 101, confidence: 0.7 },
      claimedConfidence: 0.7,
      latencyMs: 12,
      costUsdCents: 5,
    });
    expect(first.prevHash).toBe('');
    expect(second.prevHash).toBe(first.auditHash);
    expect(second.auditHash).not.toBe(first.auditHash);
    // Skill trace counter ticks twice for the same pattern.
    const trace = await h.skillRepo.findByPattern({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      patternSignature: patternSignatureFor({ target: 'gold_price', horizon: 1 }),
    });
    expect(trace?.successCount).toBe(2);
    expect(trace?.failureCount).toBe(0);
    // Catalogue repo received both invocation rows.
    const cohort = await h.catalogueRepo.listByCapabilityInWindow({
      tenantId: TEST_TENANT,
      capabilityId: TEST_CAPABILITY_ID,
      from: '2026-05-27T00:00:00.000Z',
      to: '2026-05-28T00:00:00.000Z',
    }) as ReadonlyArray<Invocation>;
    expect(cohort.length).toBe(2);
  });

  it('clamps claimed confidence into [0, 1]', async () => {
    const h = buildHarness();
    const capability = buildMeasuredCapability<ForecastInput, ForecastOutput>({
      capabilityId: TEST_CAPABILITY_ID,
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      claimedConfidenceFrom: () => 3.4, // unbounded — must be clamped.
      hashInput: (i) => ({ target: i.target, horizon: i.horizon }),
      hashOutput: () => ({ point: 0 }),
    });
    const wrapped = wrapAsMeasured(
      capability,
      async () => ({ point: 0, confidence: 0, costCents: 0 }),
      {
        invocationAuditRepo: h.auditRepo,
        catalogueInvocationRepo: h.catalogueRepo,
        skillTracesRepo: h.skillRepo,
        logger: h.logger,
        clock: h.clock,
        idGen: h.idGen,
      },
    );
    await wrapped({ target: 'gold_price', horizon: 1 });
    await new Promise((r) => setImmediate(r));
    const pending = await h.auditRepo.listPendingObservations({
      tenantId: TEST_TENANT,
      intelKind: 'forecast',
      olderThan: new Date(Date.now() + 1000).toISOString(),
      limit: 5,
    });
    expect(pending[0]?.claimedConfidence).toBe(1);
  });
});
