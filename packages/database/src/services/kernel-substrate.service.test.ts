/**
 * Unit tests for createKernelSubstrateService — the kernel's three
 * pluggable sinks (CoT reservoir, persona drift, provenance).
 *
 * The service is thin glue around Drizzle inserts; we mock the
 * DatabaseClient and capture the values passed to insert().values(...).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKernelSubstrateService } from './kernel-substrate.service.js';
import {
  kernelCotReservoir,
  kernelPersonaDriftEvents,
  kernelProvenance,
} from '../schemas/kernel-substrate.schema.js';
import type { DatabaseClient } from '../client.js';

interface CapturedCall {
  readonly table: 'cot' | 'drift' | 'provenance' | 'unknown';
  readonly values: Record<string, unknown>;
}

function makeStubDb(): {
  client: DatabaseClient;
  readonly calls: ReadonlyArray<CapturedCall>;
} {
  const calls: CapturedCall[] = [];

  const client = {
    insert: (tableRef: unknown) => {
      let tableName: CapturedCall['table'] = 'unknown';
      if (tableRef === kernelCotReservoir) tableName = 'cot';
      else if (tableRef === kernelPersonaDriftEvents) tableName = 'drift';
      else if (tableRef === kernelProvenance) tableName = 'provenance';

      let captured = false;
      const finalize = (v: Record<string, unknown>): Promise<void> => {
        if (!captured) {
          calls.push({ table: tableName, values: v });
          captured = true;
        }
        return Promise.resolve();
      };

      return {
        values: (v: Record<string, unknown>) => ({
          // For chains that call `.onConflictDoNothing()`.
          onConflictDoNothing: () => ({
            then: (
              resolve: (x: unknown) => unknown,
              reject?: (e: unknown) => void,
            ) => finalize(v).then(resolve, reject),
          }),
          // For chains without onConflict (drift).
          then: (
            resolve: (x: unknown) => unknown,
            reject?: (e: unknown) => void,
          ) => finalize(v).then(resolve, reject),
        }),
      };
    },
  } as unknown as DatabaseClient;

  return {
    client,
    get calls() {
      return calls;
    },
  } as never;
}

describe('createKernelSubstrateService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('cot.capture inserts the sample with tenant scope', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: 't' });
    await svc.cot.capture({
      thoughtId: 'th-1',
      threadId: 'thr-1',
      stakes: 'low',
      thoughtText: 'reasoning here',
      capturedAt: '2026-05-08T12:00:00Z',
    });
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0]!;
    expect(call.table).toBe('cot');
    expect(call.values.thoughtId).toBe('th-1');
    expect(call.values.tenantId).toBe('t');
    expect(call.values.threadId).toBe('thr-1');
    expect(call.values.stakes).toBe('low');
    expect(call.values.thoughtText).toBe('reasoning here');
    expect(call.values.capturedAt).toBeInstanceOf(Date);
  });

  it('cot.capture supports null tenant for platform-scope thoughts', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: null });
    await svc.cot.capture({
      thoughtId: 'th-2',
      threadId: 'thr-2',
      stakes: 'high',
      thoughtText: 'platform thought',
      capturedAt: '2026-05-08T12:00:00Z',
    });
    expect(stub.calls[0]!.values.tenantId).toBeNull();
  });

  it('drift.record inserts with a generated UUID', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: 't' });
    await svc.drift.record({
      thoughtId: 'th-3',
      personaId: 'p',
      violationType: 'taboo',
      excerpt: 'bad',
      severity: 'high',
      detectedAt: '2026-05-08T12:00:00Z',
    });
    const call = stub.calls[0]!;
    expect(call.table).toBe('drift');
    expect(call.values.violationType).toBe('taboo');
    expect(call.values.severity).toBe('high');
    expect(call.values.tenantId).toBe('t');
    expect(typeof call.values.id).toBe('string');
    expect((call.values.id as string).length).toBeGreaterThan(10);
    expect(call.values.detectedAt).toBeInstanceOf(Date);
  });

  it('provenance.record passes through arrays + tool summaries', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: 't' });
    await svc.provenance.record({
      thoughtId: 'th-4',
      threadId: 'thr-4',
      scopeKind: 'tenant',
      tier: 'lease',
      stakes: 'medium',
      inputHash: 'in',
      outputHash: 'out',
      sensorId: 'sensor-1',
      modelId: 'model-1',
      cacheHit: true,
      judgeScore: 0.8,
      cohortFingerprints: ['fp1', 'fp2'],
      toolCallSummaries: [
        { toolName: 'rent.send', latencyMs: 100, ok: true },
      ],
      latencyMs: 250,
      producedAt: '2026-05-08T12:00:00Z',
    });
    const call = stub.calls[0]!;
    expect(call.table).toBe('provenance');
    expect(call.values.cacheHit).toBe('true');
    expect(call.values.judgeScore).toBe(0.8);
    expect(call.values.cohortFingerprints).toEqual(['fp1', 'fp2']);
    expect(Array.isArray(call.values.toolCallSummaries)).toBe(true);
    expect(call.values.latencyMs).toBe(250);
    expect(call.values.producedAt).toBeInstanceOf(Date);
  });

  it('provenance.record converts cacheHit=false to "false"', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: 't' });
    await svc.provenance.record({
      thoughtId: 'th-5',
      threadId: 'thr-5',
      scopeKind: 'platform',
      tier: 'org',
      stakes: 'low',
      inputHash: 'i',
      outputHash: 'o',
      sensorId: 's',
      modelId: 'm',
      cacheHit: false,
      judgeScore: null,
      cohortFingerprints: [],
      toolCallSummaries: [],
      latencyMs: 1,
      producedAt: '2026-05-08T12:00:00Z',
    });
    expect(stub.calls[0]!.values.cacheHit).toBe('false');
    expect(stub.calls[0]!.values.judgeScore).toBeNull();
  });

  it('preserves the supplied scopeKind and tier', async () => {
    const stub = makeStubDb();
    const svc = createKernelSubstrateService(stub.client, { tenantId: null });
    await svc.provenance.record({
      thoughtId: 'th-6',
      threadId: 'thr-6',
      scopeKind: 'platform',
      tier: 'industry',
      stakes: 'critical',
      inputHash: 'i',
      outputHash: 'o',
      sensorId: 's',
      modelId: 'm',
      cacheHit: true,
      judgeScore: 0.5,
      cohortFingerprints: [],
      toolCallSummaries: [],
      latencyMs: 100,
      producedAt: '2026-05-08T12:00:00Z',
    });
    expect(stub.calls[0]!.values.scopeKind).toBe('platform');
    expect(stub.calls[0]!.values.tier).toBe('industry');
  });
});
