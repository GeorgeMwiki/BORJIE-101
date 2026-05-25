/**
 * Consolidation runner tests.
 *
 * Mocks the Drizzle client + the Anthropic client (and stubs the
 * scope-discovery hook) so we exercise the orchestration of
 * `runConsolidationForActiveTenants` without touching @borjie/database
 * adapters or the real Anthropic SDK.
 *
 * Cases:
 *   1. no-op when env-equivalent prerequisites are missing
 *   2. calls the cycle once per active tenant
 *   3. aggregates counts across multiple tenants
 *   4. continues across a per-tenant failure (logs + reports the error)
 *   5. invalid Haiku JSON does not crash the runner
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runConsolidationForActiveTenants,
  type ActiveScope,
  type AnthropicLikeClient,
} from '../consolidation-runner';

// We mock the database adapters at the module boundary so the runner
// uses our spies instead of trying to talk to a real Postgres.
vi.mock('@borjie/database', () => {
  // Per-test mocks are mutated through `mocks.*` (set in beforeEach).
  return {
    createEpisodicMemoryService: () => globalThis.__memoryMocks.episodic,
    createSemanticMemoryService: () => globalThis.__memoryMocks.semantic,
    createProceduralMemoryService: () => globalThis.__memoryMocks.procedural,
    createReflectiveMemoryService: () => globalThis.__memoryMocks.reflective,
  };
});

declare global {
  // eslint-disable-next-line no-var
  var __memoryMocks: {
    episodic: any;
    semantic: any;
    procedural: any;
    reflective: any;
  };
}

function makeMemoryMocks(opts: {
  episodicEntries?: ReadonlyArray<any>;
  purgeReturns?: number;
  decayReturns?: number;
} = {}) {
  return {
    episodic: {
      recall: vi.fn().mockResolvedValue(opts.episodicEntries ?? []),
      purgeExpired: vi.fn().mockResolvedValue(opts.purgeReturns ?? 0),
      record: vi.fn().mockResolvedValue(undefined),
    },
    semantic: {
      upsertFact: vi.fn().mockResolvedValue(undefined),
      lookup: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([]),
      decay: vi.fn().mockResolvedValue(opts.decayReturns ?? 0),
    },
    procedural: {
      record: vi.fn().mockResolvedValue(undefined),
      match: vi.fn().mockResolvedValue([]),
    },
    reflective: {
      record: vi.fn().mockResolvedValue(undefined),
      latest: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeAnthropic(body: string): AnthropicLikeClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: body }],
      }),
    },
  };
}

const fakeDb = { execute: vi.fn() };

describe('runConsolidationForActiveTenants', () => {
  beforeEach(() => {
    globalThis.__memoryMocks = makeMemoryMocks();
    vi.clearAllMocks();
  });

  it('no-op when prerequisites are missing', async () => {
    const summary1 = await runConsolidationForActiveTenants(null as any, null as any);
    expect(summary1.tenantsProcessed).toBe(0);
    expect(summary1.errors).toEqual([]);

    const summary2 = await runConsolidationForActiveTenants(
      fakeDb as any,
      null as any,
    );
    expect(summary2.tenantsProcessed).toBe(0);

    const summary3 = await runConsolidationForActiveTenants(
      null as any,
      makeAnthropic('[]'),
    );
    expect(summary3.tenantsProcessed).toBe(0);
  });

  it('calls the cycle once per active tenant', async () => {
    const memory = makeMemoryMocks({ episodicEntries: [], purgeReturns: 1 });
    globalThis.__memoryMocks = memory;

    const scopes: ReadonlyArray<ActiveScope> = [
      { tenantId: 't_a', userId: 'u_a' },
      { tenantId: 't_b', userId: 'u_b' },
      { tenantId: null, userId: 'u_platform' },
    ];

    const summary = await runConsolidationForActiveTenants(
      fakeDb as any,
      makeAnthropic('[]'),
      {
        discoverScopes: async () => scopes,
      },
    );

    expect(summary.tenantsProcessed).toBe(3);
    expect(memory.episodic.purgeExpired).toHaveBeenCalledTimes(3);
    expect(memory.semantic.decay).toHaveBeenCalledTimes(3);
    // semantic.decay called with each tenant
    const tenantIds = memory.semantic.decay.mock.calls.map((c: any[]) => c[0].tenantId);
    expect(tenantIds.sort()).toEqual(['t_a', 't_b', null].sort());
  });

  it('aggregates counts across multiple tenants', async () => {
    const memory = makeMemoryMocks({ purgeReturns: 5, decayReturns: 2 });
    globalThis.__memoryMocks = memory;

    const summary = await runConsolidationForActiveTenants(
      fakeDb as any,
      makeAnthropic('[]'),
      {
        discoverScopes: async () => [
          { tenantId: 't_a', userId: 'u_a' },
          { tenantId: 't_b', userId: 'u_b' },
        ],
      },
    );

    expect(summary.tenantsProcessed).toBe(2);
    expect(summary.expiredPurged).toBe(10); // 5 * 2 tenants
    expect(summary.decayedFacts).toBe(4); // 2 * 2 tenants
    expect(summary.factsUpserted).toBe(0);
    expect(summary.patternsRecorded).toBe(0);
    expect(summary.digestsWritten).toBe(0);
    expect(summary.reports).toHaveLength(2);
  });

  it('continues across a per-tenant cycle failure', async () => {
    const memory = makeMemoryMocks();
    // Make purgeExpired throw the first time it's called, succeed
    // afterwards. The runner catches per-cycle errors via the cycle's
    // own internal handling; the cycle returns a report with errors.
    let purgeCalls = 0;
    memory.episodic.purgeExpired = vi.fn().mockImplementation(async () => {
      purgeCalls += 1;
      if (purgeCalls === 1) throw new Error('boom-1');
      return 0;
    });
    globalThis.__memoryMocks = memory;

    const summary = await runConsolidationForActiveTenants(
      fakeDb as any,
      makeAnthropic('[]'),
      {
        discoverScopes: async () => [
          { tenantId: 't_a', userId: 'u_a' },
          { tenantId: 't_b', userId: 'u_b' },
        ],
      },
    );

    // Both tenants got a cycle (the cycle catches purge errors
    // internally and continues). Errors array surfaces the boom.
    expect(summary.tenantsProcessed).toBe(2);
    expect(summary.errors.some((e) => e.includes('boom-1'))).toBe(true);
  });

  it('invalid Haiku JSON does not crash the runner', async () => {
    const memory = makeMemoryMocks({
      episodicEntries: [
        {
          id: 'e1',
          tenantId: 't_a',
          userId: 'u_a',
          threadId: 'thr',
          turnId: 'tu',
          kind: 'user-message',
          summary: 'hi',
          payload: {},
          capturedAt: new Date().toISOString(),
          expiresAt: null,
        },
      ],
    });
    globalThis.__memoryMocks = memory;

    const summary = await runConsolidationForActiveTenants(
      fakeDb as any,
      makeAnthropic('not json at all'),
      {
        discoverScopes: async () => [{ tenantId: 't_a', userId: 'u_a' }],
      },
    );

    expect(summary.tenantsProcessed).toBe(1);
    expect(summary.factsUpserted).toBe(0);
    expect(memory.semantic.upsertFact).not.toHaveBeenCalled();
  });
});
