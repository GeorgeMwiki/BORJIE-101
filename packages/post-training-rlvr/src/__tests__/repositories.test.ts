/**
 * Repositories — in-memory CRUD smoke tests.
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryRlvrRunRepository } from '../repositories/rlvr-run.repository.js';
import { createInMemoryRlvrTraceRepository } from '../repositories/rlvr-trace.repository.js';
import { createInMemoryRlvrVerificationRepository } from '../repositories/rlvr-verification.repository.js';
import { createInMemoryRlvrCuratedExampleRepository } from '../repositories/rlvr-curated-example.repository.js';
import type {
  CuratedExample,
  RlvrRun,
  RlvrTrace,
  VerificationResult,
} from '../types.js';
import type { StoredVerification } from '../repositories/rlvr-verification.repository.js';

const RUN: RlvrRun = Object.freeze({
  id: 'run-1',
  tenantId: 'tenant-A',
  kind: 'synthetic_test',
  startedAt: '2026-05-26T00:00:00.000Z',
  endedAt: null,
  status: 'pending',
  verifierSet: Object.freeze(['tra-schema']),
  auditHash: 'hash-1',
  prevHash: 'GENESIS',
});

const TRACE: RlvrTrace = Object.freeze({
  id: 'trace-1',
  runId: 'run-1',
  tenantId: 'tenant-A',
  prompt: 'p',
  completion: 'c',
  toolCalls: [],
  metadata: Object.freeze({ synthetic: true }),
  capturedAt: '2026-05-26T00:00:00.000Z',
});

const VRESULT: VerificationResult = Object.freeze({
  verifierName: 'tra-schema',
  verdict: 'pass',
  reward: 1,
  evidence: {},
  confidence: 1,
});

const STORED: StoredVerification = Object.freeze({
  id: 'v-1',
  traceId: 'trace-1',
  tenantId: 'tenant-A',
  result: VRESULT,
  verifiedAt: '2026-05-26T00:00:00.000Z',
  auditHash: 'hash-v',
});

const EXAMPLE: CuratedExample = Object.freeze({
  id: 'ex-1',
  runId: 'run-1',
  traceId: 'trace-1',
  tenantId: 'tenant-A',
  prompt: Object.freeze({ text: 'p' }),
  completion: Object.freeze({ text: 'c' }),
  reward: 1,
  included: true,
  exclusionReason: null,
  curatedAt: '2026-05-26T00:00:00.000Z',
  auditHash: 'hash-ex',
});

describe('repositories', () => {
  it('rlvr-run repo: create + findById + updateStatus', async () => {
    const repo = createInMemoryRlvrRunRepository();
    await repo.create(RUN);
    const found = await repo.findById(RUN.id);
    expect(found?.status).toBe('pending');
    const updated = await repo.updateStatus(
      RUN.id,
      'completed',
      '2026-05-26T01:00:00.000Z',
    );
    expect(updated.status).toBe('completed');
    expect(updated.endedAt).toBe('2026-05-26T01:00:00.000Z');
  });

  it('rlvr-run repo: rejects duplicate id', async () => {
    const repo = createInMemoryRlvrRunRepository();
    await repo.create(RUN);
    await expect(repo.create(RUN)).rejects.toThrow(/already exists/);
  });

  it('rlvr-trace repo: create + attachRedacted + listByRun', async () => {
    const repo = createInMemoryRlvrTraceRepository();
    await repo.create(TRACE);
    const redacted: RlvrTrace = Object.freeze({
      ...TRACE,
      prompt: 'REDACTED',
    });
    await repo.attachRedacted(TRACE.id, redacted);
    const list = await repo.listByRun('run-1');
    expect(list).toHaveLength(1);
  });

  it('rlvr-verification repo: create + listByTrace', async () => {
    const repo = createInMemoryRlvrVerificationRepository();
    await repo.create(STORED);
    const list = await repo.listByTrace('trace-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.result.verdict).toBe('pass');
  });

  it('rlvr-curated repo: create + listIncludedByRun', async () => {
    const repo = createInMemoryRlvrCuratedExampleRepository();
    await repo.create(EXAMPLE);
    await repo.create(Object.freeze({
      ...EXAMPLE,
      id: 'ex-2',
      included: false,
      exclusionReason: 'reward_below_floor',
    }));
    const all = await repo.listByRun('run-1');
    expect(all).toHaveLength(2);
    const included = await repo.listIncludedByRun('run-1');
    expect(included).toHaveLength(1);
    expect(included[0]?.id).toBe('ex-1');
  });
});
