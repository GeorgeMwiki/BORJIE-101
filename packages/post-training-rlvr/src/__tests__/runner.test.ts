/**
 * Runner — happy path, all-fail, partial pass. Each test uses a
 * deterministic id/clock and in-memory repositories.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { RlvrRunner } from '../runner/rlvr-runner.js';
import { createInMemoryRlvrRunRepository } from '../repositories/rlvr-run.repository.js';
import { createInMemoryRlvrTraceRepository } from '../repositories/rlvr-trace.repository.js';
import { createInMemoryRlvrVerificationRepository } from '../repositories/rlvr-verification.repository.js';
import { createInMemoryRlvrCuratedExampleRepository } from '../repositories/rlvr-curated-example.repository.js';
import { createVerifierRegistry } from '../verifiers/registry.js';
import { createTraSchemaVerifier } from '../verifiers/builtins/tra-schema.js';
import { createRoyaltyMathVerifier } from '../verifiers/builtins/royalty-math.js';
import { createMutationAuthorityVerifier } from '../verifiers/builtins/mutation-authority.js';
import { createTraceCollector } from '../pipeline/trace-collector.js';
import type { RlvrTrace } from '../types.js';

function buildRunner() {
  let counter = 0;
  const idGen = (): string => `id-${++counter}`;
  const clock = (): Date => new Date('2026-05-26T00:00:00.000Z');

  const registry = createVerifierRegistry([])
    .register(createTraSchemaVerifier())
    .register(createRoyaltyMathVerifier())
    .register(createMutationAuthorityVerifier());

  const deps = {
    runs: createInMemoryRlvrRunRepository(),
    traces: createInMemoryRlvrTraceRepository(),
    verifications: createInMemoryRlvrVerificationRepository(),
    curated: createInMemoryRlvrCuratedExampleRepository(),
    registry,
    idGen,
    clock,
  };
  return {
    runner: new RlvrRunner(deps),
    deps,
    collector: createTraceCollector({ idGen, clock }),
  };
}

const REDACTION = Object.freeze({
  tenantId: 'tenant-A',
  allowlist: ['metadata.regulation_section', 'metadata.mineral'],
});

describe('RlvrRunner', () => {
  let env: ReturnType<typeof buildRunner>;
  beforeEach(() => {
    env = buildRunner();
  });

  it('happy path — every verifier passes, example is included', async () => {
    const run = await env.runner.startRun({
      tenantId: 'tenant-A',
      kind: 'synthetic_test',
    });
    const trace: RlvrTrace = env.collector.collect({
      runId: run.id,
      tenantId: 'tenant-A',
      prompt: 'Compose a TRA royalty return for April 2026',
      completion: 'OK',
      metadata: {
        synthetic: true,
        tra_filing: {
          tin: '1234567890',
          filing_period_iso: '2026-04',
          mineral: 'gold',
          tonnage: 100,
        },
        royalty: {
          tonnage: 100,
          unit_price: 50,
          rate_pct: 6,
          declared_amount: 300,
        },
        mutation: {
          proposed_tier: 't1',
          required_tier: 't1',
          approvers: ['owner'],
        },
      },
    });
    await env.runner.ingestTrace(trace);
    const output = await env.runner.completeRun({
      runId: run.id,
      redaction: REDACTION,
    });
    expect(output.run.status).toBe('completed');
    expect(output.includedCount).toBe(1);
    expect(output.excludedCount).toBe(0);
  });

  it('all-fail — bad filing + bad math → excluded', async () => {
    const run = await env.runner.startRun({
      tenantId: 'tenant-A',
      kind: 'synthetic_test',
    });
    const trace: RlvrTrace = env.collector.collect({
      runId: run.id,
      tenantId: 'tenant-A',
      prompt: 'Bad return',
      completion: 'BadOK',
      metadata: {
        synthetic: true,
        tra_filing: {
          tin: 'NOT-A-TIN',
          filing_period_iso: '2026-04',
          mineral: 'gold',
          tonnage: 1,
        },
      },
    });
    await env.runner.ingestTrace(trace);
    const output = await env.runner.completeRun({
      runId: run.id,
      redaction: REDACTION,
    });
    expect(output.includedCount).toBe(0);
    expect(output.excludedCount).toBe(1);
    expect(output.examples[0]?.exclusionReason).toBe('any_fail');
  });

  it('partial pass — royalty within ε included, royalty off excluded', async () => {
    const run = await env.runner.startRun({
      tenantId: 'tenant-A',
      kind: 'synthetic_test',
    });
    const good: RlvrTrace = env.collector.collect({
      runId: run.id,
      tenantId: 'tenant-A',
      prompt: 'Good royalty',
      completion: 'Good',
      metadata: {
        synthetic: true,
        royalty: {
          tonnage: 100,
          unit_price: 50,
          rate_pct: 6,
          declared_amount: 300,
        },
      },
    });
    const bad: RlvrTrace = env.collector.collect({
      runId: run.id,
      tenantId: 'tenant-A',
      prompt: 'Bad royalty',
      completion: 'Bad',
      metadata: {
        synthetic: true,
        royalty: {
          tonnage: 100,
          unit_price: 50,
          rate_pct: 6,
          declared_amount: 30000,
        },
      },
    });
    await env.runner.ingestTrace(good);
    await env.runner.ingestTrace(bad);
    const output = await env.runner.completeRun({
      runId: run.id,
      redaction: REDACTION,
    });
    expect(output.includedCount).toBe(1);
    expect(output.excludedCount).toBe(1);
  });
});
