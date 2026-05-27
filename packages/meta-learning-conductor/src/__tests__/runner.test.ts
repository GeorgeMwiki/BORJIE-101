import { describe, expect, it } from 'vitest';
import { createInMemoryMetaLearningRepository } from '../repositories/in-memory-repo.js';
import { createMetaLearningRunner } from '../runner/meta-learning-runner.js';
import type {
  AuditChainPort,
  CapabilityCataloguePort,
  ClockPort,
  Decision,
  EvaluatorPort,
  Logger,
  PIIRedactor,
  RawTrace,
  TraceSourcePort,
  UuidPort,
} from '../types.js';

const noopLogger: Logger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

const identityRedactor: PIIRedactor = Object.freeze({
  redact: (v: unknown) => v,
});

function makeClock(seed = '2026-05-26T10:00:00.000Z'): ClockPort {
  return Object.freeze({
    nowIso: () => seed,
    nowMs: () => Date.parse(seed),
  });
}

function makeUuid(): UuidPort {
  let n = 0;
  return Object.freeze({
    next: () => {
      n += 1;
      return `id-${n.toString().padStart(4, '0')}`;
    },
  });
}

function deterministicHash(): AuditChainPort {
  return Object.freeze({
    hash: (prev, payload) =>
      `h-${prev ?? 'genesis'}-${JSON.stringify(payload).length}`,
  });
}

interface CapStub {
  readonly port: CapabilityCataloguePort;
  readonly decisions: Array<{
    tenantId: string;
    capabilityId: string;
    decision: Decision;
  }>;
}

function makeCapStub(): CapStub {
  const decisions: Array<{
    tenantId: string;
    capabilityId: string;
    decision: Decision;
  }> = [];
  const port: CapabilityCataloguePort = Object.freeze({
    getCurrentMetric: async () => 0.6,
    applyDecision: async (args) => {
      decisions.push({
        tenantId: args.tenantId,
        capabilityId: args.capabilityId,
        decision: args.decision,
      });
    },
  });
  return { port, decisions };
}

function stubTraces(traces: ReadonlyArray<RawTrace>): TraceSourcePort {
  return Object.freeze({
    pull: async () => traces,
  });
}

function stubEval(before: number, after: number): EvaluatorPort {
  return Object.freeze({
    score: async ({ side }) => (side === 'before' ? before : after),
  });
}

function trace(reward: number, prompt: string): RawTrace {
  return Object.freeze({
    id: `t-${prompt}`,
    tenantId: 'tenant-a',
    capabilityId: 'cap-1',
    prompt: { q: prompt },
    completion: { a: prompt + '-out' },
    baseReward: reward,
    coverageScore: 0.5,
    confidenceScore: 0.8,
    redactionPenalty: 0.0,
    occurredAt: '2026-05-25T00:00:00Z',
  });
}

describe('createMetaLearningRunner', () => {
  it('runs a full happy-path loop and promotes when delta is large', async () => {
    const repository = createInMemoryMetaLearningRepository();
    const cap = makeCapStub();

    const runner = createMetaLearningRunner({
      capabilityCatalogue: cap.port,
      traceSource: stubTraces([trace(0.5, 'a'), trace(0.7, 'b')]),
      evaluator: stubEval(0.5, 0.7),
      redactor: identityRedactor,
      repository,
      auditChain: deterministicHash(),
      clock: makeClock(),
      uuid: makeUuid(),
      logger: noopLogger,
    });

    const out = await runner.runOnce({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
    });

    expect(out.failed).toBe(false);
    expect(out.decision).toBe('promote');
    expect(out.examplesCount).toBe(2);
    expect(cap.decisions[0]?.decision).toBe('promote');
    expect(out.run.status).toBe('succeeded');
    expect(out.run.endedAt).not.toBeNull();
  });

  it('rolls back when previous decision was promote and we regress', async () => {
    const repository = createInMemoryMetaLearningRepository();
    const cap = makeCapStub();

    // Pre-seed a prior 'promote' run.
    await repository.insertRun({
      id: 'prior',
      tenantId: 'tenant-a',
      startedAt: '2026-05-25T08:00:00.000Z',
      endedAt: '2026-05-25T08:10:00.000Z',
      status: 'succeeded',
      capabilityId: 'cap-1',
      examplesCount: 5,
      evalMetricBefore: 0.5,
      evalMetricAfter: 0.7,
      decision: 'promote',
      auditHash: 'prior-hash',
      prevHash: null,
    });

    const runner = createMetaLearningRunner({
      capabilityCatalogue: cap.port,
      traceSource: stubTraces([trace(0.4, 'a')]),
      evaluator: stubEval(0.7, 0.5), // regression
      redactor: identityRedactor,
      repository,
      auditChain: deterministicHash(),
      clock: makeClock(),
      uuid: makeUuid(),
      logger: noopLogger,
    });

    const out = await runner.runOnce({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
    });

    expect(out.decision).toBe('rollback');
    expect(cap.decisions[0]?.decision).toBe('rollback');
  });

  it('marks the run failed when the evaluator throws', async () => {
    const repository = createInMemoryMetaLearningRepository();
    const cap = makeCapStub();
    const evaluator: EvaluatorPort = {
      score: async () => {
        throw new Error('boom');
      },
    };

    const runner = createMetaLearningRunner({
      capabilityCatalogue: cap.port,
      traceSource: stubTraces([trace(0.5, 'a')]),
      evaluator,
      redactor: identityRedactor,
      repository,
      auditChain: deterministicHash(),
      clock: makeClock(),
      uuid: makeUuid(),
      logger: noopLogger,
    });

    const out = await runner.runOnce({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
    });

    expect(out.failed).toBe(true);
    expect(out.decision).toBe(null);
    expect(cap.decisions).toHaveLength(0);
    expect(out.run.status).toBe('failed');
  });

  it('chains run audit hashes via prev_hash', async () => {
    const repository = createInMemoryMetaLearningRepository();
    const cap = makeCapStub();

    const runner = createMetaLearningRunner({
      capabilityCatalogue: cap.port,
      traceSource: stubTraces([trace(0.5, 'a')]),
      evaluator: stubEval(0.5, 0.5),
      redactor: identityRedactor,
      repository,
      auditChain: deterministicHash(),
      clock: makeClock(),
      uuid: makeUuid(),
      logger: noopLogger,
    });

    const a = await runner.runOnce({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
    });
    const b = await runner.runOnce({
      tenantId: 'tenant-a',
      capabilityId: 'cap-1',
    });

    expect(a.run.prevHash).toBeNull();
    expect(b.run.prevHash).toBe(a.run.auditHash);
  });
});
