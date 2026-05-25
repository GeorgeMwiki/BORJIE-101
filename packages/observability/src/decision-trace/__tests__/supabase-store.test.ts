/**
 * SupabaseDecisionTraceStore unit tests.
 *
 * Locks the contract documented in `./supabase-store.ts`:
 *   - save() projects DecisionTraceFinalised → row shape
 *   - save() is idempotent on traceId (upsert + ignoreDuplicates)
 *   - save() retries 3 times with backoff before dropping
 *   - save() NEVER throws even when the client throws
 *   - load() returns null on miss, on error, and on invalid id
 *   - load() hydrates a row back into an immutable snapshot
 *   - constructor rejects a missing client
 */

import { describe, expect, it, vi } from 'vitest';

import { SupabaseDecisionTraceStore } from '../supabase-store.js';
import type {
  SupabaseLikeClient,
  SupabaseLikeQueryBuilder,
} from '../supabase-store.js';
import type { DecisionTraceFinalised } from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTrace(
  override: Partial<DecisionTraceFinalised> = {},
): DecisionTraceFinalised {
  return Object.freeze({
    traceId: override.traceId ?? 'trace_abc_1',
    name: override.name ?? 'brain.draft_lease',
    startedAt: override.startedAt ?? '2026-01-01T00:00:00.000Z',
    finalisedAt: override.finalisedAt ?? '2026-01-01T00:00:01.000Z',
    durationMs: override.durationMs ?? 1000,
    context: Object.freeze({
      tenantId: 'tenant_1',
      userId: 'user_1',
      requestId: 'req_1',
      parentTraceId: undefined,
      attributes: Object.freeze({ feature_flag: 'on' }),
      ...(override.context ?? {}),
    }),
    inputs: Object.freeze({ propertyId: 'p1', ...(override.inputs ?? {}) }),
    branches: override.branches ?? [
      Object.freeze({
        id: 'draft',
        label: 'Draft the lease',
        rationale: 'kyc green',
        score: 0.9,
        recordedAt: '2026-01-01T00:00:00.500Z',
      }),
    ],
    chosenBranchId: override.chosenBranchId ?? 'draft',
    chosenRationale: override.chosenRationale ?? 'kyc green',
    outcome: override.outcome ?? 'approved',
    output: override.output ?? { leaseId: 'lease_1' },
    error: override.error ?? null,
  });
}

interface MockState {
  inserted: Array<Record<string, unknown>>;
  insertResponses: Array<{ error: { message: string } | null } | Error>;
  loadResponse:
    | { data: Record<string, unknown> | null; error: { message: string } | null }
    | Error;
}

function makeMockClient(state: MockState): SupabaseLikeClient {
  const insert: SupabaseLikeQueryBuilder['insert'] = vi.fn(async (rows) => {
    state.inserted.push(...(rows as Array<Record<string, unknown>>));
    const next = state.insertResponses.shift();
    if (next === undefined) return { error: null };
    if (next instanceof Error) throw next;
    return next;
  });
  let lastEq: { column: string; value: string } | null = null;
  const builder: SupabaseLikeQueryBuilder = {
    insert,
    select: vi.fn(() => builder),
    eq: vi.fn((column, value) => {
      lastEq = { column, value };
      return builder;
    }),
    maybeSingle: vi.fn(async () => {
      if (state.loadResponse instanceof Error) throw state.loadResponse;
      return state.loadResponse;
    }),
  };
  // Track last-eq for assertions.
  (builder as unknown as { __lastEq: () => typeof lastEq }).__lastEq = () =>
    lastEq;
  return {
    from: vi.fn(() => builder),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupabaseDecisionTraceStore', () => {
  it('rejects construction without a client', () => {
    expect(
      () =>
        new SupabaseDecisionTraceStore({
          client: undefined as unknown as SupabaseLikeClient,
        }),
    ).toThrow(/client is required/);
  });

  it('save() projects the trace to the row shape', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [{ error: null }],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    const trace = makeTrace();
    await store.save(trace);
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row.id).toBe('trace_abc_1');
    expect(row.tenant_id).toBe('tenant_1');
    expect(row.user_id).toBe('user_1');
    expect(row.name).toBe('brain.draft_lease');
    expect(row.outcome).toBe('approved');
    expect(row.duration_ms).toBe(1000);
    expect(Array.isArray(row.branches)).toBe(true);
    expect((row.branches as unknown[])).toHaveLength(1);
    expect(row.attributes).toEqual({ feature_flag: 'on' });
  });

  it('save() retries 3 times before dropping (logger warns once)', async () => {
    const warnings: Array<{ meta: Record<string, unknown>; msg: string }> = [];
    const state: MockState = {
      inserted: [],
      // All three attempts return an error.
      insertResponses: [
        { error: { message: 'boom-1' } },
        { error: { message: 'boom-2' } },
        { error: { message: 'boom-3' } },
      ],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
      logger: {
        warn: (meta, msg) => warnings.push({ meta, msg }),
      },
    });
    await store.save(makeTrace());
    // Three insert calls, one warning logged.
    expect(state.inserted).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.meta.attempts).toBe(3);
    expect(warnings[0]?.meta.lastError).toBe('boom-3');
  });

  it('save() never throws even when the client throws', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [
        new Error('network down'),
        new Error('still down'),
        new Error('really down'),
      ],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    await expect(store.save(makeTrace())).resolves.toBeUndefined();
  });

  it('save() succeeds on the third attempt without logging', async () => {
    const warnings: Array<unknown> = [];
    const state: MockState = {
      inserted: [],
      insertResponses: [
        { error: { message: 'flaky' } },
        { error: { message: 'flaky' } },
        { error: null },
      ],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
      logger: {
        warn: (meta) => warnings.push(meta),
      },
    });
    await store.save(makeTrace());
    expect(state.inserted).toHaveLength(3);
    expect(warnings).toHaveLength(0);
  });

  it('save() uses upsert+ignoreDuplicates so retried publishes are no-ops', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [{ error: null }],
      loadResponse: { data: null, error: null },
    };
    const insertSpy = vi.fn(async (
      rows: ReadonlyArray<Record<string, unknown>>,
      options?: {
        upsert?: boolean;
        onConflict?: string;
        ignoreDuplicates?: boolean;
      },
    ) => {
      state.inserted.push(...rows);
      return { error: null };
    });
    const builder: SupabaseLikeQueryBuilder = {
      insert: insertSpy,
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const client: SupabaseLikeClient = { from: () => builder };
    const store = new SupabaseDecisionTraceStore({
      client,
      sleep: async () => {},
    });
    await store.save(makeTrace());
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, opts] = insertSpy.mock.calls[0]!;
    expect(opts?.upsert).toBe(true);
    expect(opts?.onConflict).toBe('id');
    expect(opts?.ignoreDuplicates).toBe(true);
  });

  it('load() returns null on miss', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    const result = await store.load('trace_missing');
    expect(result).toBeNull();
  });

  it('load() returns null on invalid id (empty / non-string)', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [],
      loadResponse: { data: null, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    expect(await store.load('')).toBeNull();
    expect(
      await store.load(undefined as unknown as string),
    ).toBeNull();
  });

  it('load() returns null when the client throws', async () => {
    const state: MockState = {
      inserted: [],
      insertResponses: [],
      loadResponse: new Error('connection refused'),
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    const result = await store.load('trace_x');
    expect(result).toBeNull();
  });

  it('load() hydrates a row back into an immutable snapshot', async () => {
    const dbRow = {
      id: 'trace_hydrate_1',
      tenant_id: 'tenant_42',
      name: 'approvals.approve',
      started_at: '2026-02-01T00:00:00.000Z',
      finalised_at: '2026-02-01T00:00:00.500Z',
      duration_ms: 500,
      inputs: { approvalId: 'apr_1' },
      branches: [
        {
          id: 'approve',
          label: 'Approve',
          rationale: 'four-eye cleared',
          score: 0.95,
          recordedAt: '2026-02-01T00:00:00.100Z',
        },
        {
          id: 'reject',
          label: 'Reject',
          rationale: 'counterfactual',
          recordedAt: '2026-02-01T00:00:00.200Z',
        },
      ],
      chosen_branch_id: 'approve',
      chosen_rationale: 'four-eye cleared',
      outcome: 'approved',
      attributes: { surface: 'owner.dashboard' },
      output: { approvalId: 'apr_1', status: 'approved' },
      error: null,
      user_id: 'user_99',
      request_id: 'req_abc',
      parent_trace_id: null,
    };
    const state: MockState = {
      inserted: [],
      insertResponses: [],
      loadResponse: { data: dbRow, error: null },
    };
    const store = new SupabaseDecisionTraceStore({
      client: makeMockClient(state),
      sleep: async () => {},
    });
    const result = await store.load('trace_hydrate_1');
    expect(result).not.toBeNull();
    expect(result?.traceId).toBe('trace_hydrate_1');
    expect(result?.context.tenantId).toBe('tenant_42');
    expect(result?.context.userId).toBe('user_99');
    expect(result?.outcome).toBe('approved');
    expect(result?.branches).toHaveLength(2);
    expect(result?.branches[0]?.id).toBe('approve');
    expect(result?.branches[0]?.score).toBe(0.95);
    // Should be deep-frozen.
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.branches)).toBe(true);
  });
});
