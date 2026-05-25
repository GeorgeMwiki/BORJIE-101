/**
 * Decision-trace replay — unit tests.
 *
 * Covers:
 *   - empty source ⇒ all-zero summary
 *   - 5 traces, all replays match original kind ⇒ 0 kindFlips
 *   - 5 traces, 2 kind flips ⇒ kindFlips = 2
 *   - new-refusal counter (was answer, now refusal)
 *   - new-answer counter (was refusal, now answer)
 *   - mean + p95 confidence-delta calculations
 *   - Postgres source maps row shape correctly with mocked client
 */

import { describe, it, expect, vi } from 'vitest';

import {
  runDecisionReplay,
  type ReplayInput,
  type ReplaySource,
  type ReplayThinkFn,
} from '../kernel/introspection/trace-replay.js';
import {
  createPostgresReplaySource,
  type PostgresProvenanceQueryClient,
} from '../kernel/introspection/trace-replay-postgres-source.js';

// ─── fixtures ─────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<ReplayInput> = {}): ReplayInput {
  return {
    thoughtId: overrides.thoughtId ?? 't_1',
    threadId: overrides.threadId ?? 'th_1',
    userMessage: overrides.userMessage ?? 'what is my rent?',
    scope: overrides.scope ?? {
      kind: 'tenant',
      tenantId: 'tn_1',
      actorUserId: 'u_1',
      roles: ['resident'],
      personaId: 'tenant-resident',
    },
    tier: overrides.tier ?? 'tenant',
    stakes: overrides.stakes ?? 'low',
    surface: overrides.surface ?? 'tenant-app',
    originalDecisionKind: overrides.originalDecisionKind ?? 'answer',
    originalSensorId: overrides.originalSensorId ?? 'claude-opus',
    originalConfidenceOverall: overrides.originalConfidenceOverall ?? 0.8,
    originalProducedAt:
      overrides.originalProducedAt ?? '2026-04-01T00:00:00.000Z',
  };
}

function makeSource(traces: ReadonlyArray<ReplayInput>): ReplaySource {
  return {
    fetchTraces: async () => traces,
  };
}

// A think-fn factory: maps thoughtId → { kind, confidenceOverall, sensorId? }.
function makeThink(
  table: Record<
    string,
    {
      kind: 'answer' | 'softened' | 'refusal';
      overall: number;
      sensorId?: string;
      reason?: string;
    }
  >,
): ReplayThinkFn {
  return async (req) => {
    // Pull the thoughtId from the rebuilt request: we encode the
    // thoughtId into threadId via the test fixtures so the think-fn
    // can retrieve the response. Fallback: throw.
    const r = req as { threadId: string };
    const key = r.threadId;
    const out = table[key];
    if (!out) throw new Error(`no canned reply for ${key}`);
    if (out.kind === 'refusal') {
      return {
        kind: 'refusal',
        provenance: { sensorId: out.sensorId ?? '__refused__' },
        reason: out.reason ?? 'blocked',
      };
    }
    return {
      kind: out.kind,
      confidence: { overall: out.overall },
      provenance: { sensorId: out.sensorId ?? 'claude-sonnet' },
    };
  };
}

// ─── tests ────────────────────────────────────────────────────────────

describe('runDecisionReplay', () => {
  it('returns all-zero summary when the source is empty', async () => {
    const result = await runDecisionReplay(
      { limit: 100 },
      {
        source: makeSource([]),
        think: vi.fn(),
      },
    );

    expect(result.deltas).toEqual([]);
    expect(result.summary).toEqual({
      totalReplayed: 0,
      kindFlips: 0,
      meanConfidenceDelta: 0,
      p95ConfidenceDelta: 0,
      newRefusals: 0,
      newAnswers: 0,
      perCategoryRates: { answer: 0, softened: 0, refusal: 0 },
    });
  });

  it('reports 0 kind flips when every replay matches the original kind', async () => {
    const traces = Array.from({ length: 5 }, (_, i) =>
      makeTrace({
        thoughtId: `t_${i}`,
        threadId: `th_${i}`,
        originalDecisionKind: 'answer',
        originalConfidenceOverall: 0.7,
      }),
    );

    const table = Object.fromEntries(
      traces.map((t) => [t.threadId, { kind: 'answer' as const, overall: 0.72 }]),
    );

    const result = await runDecisionReplay(
      { limit: 100 },
      {
        source: makeSource(traces),
        think: makeThink(table),
      },
    );

    expect(result.summary.totalReplayed).toBe(5);
    expect(result.summary.kindFlips).toBe(0);
    expect(result.summary.newRefusals).toBe(0);
    expect(result.summary.newAnswers).toBe(0);
    expect(result.summary.perCategoryRates).toEqual({
      answer: 1,
      softened: 0,
      refusal: 0,
    });
  });

  it('counts kind flips when 2 of 5 traces flip', async () => {
    const traces = Array.from({ length: 5 }, (_, i) =>
      makeTrace({
        thoughtId: `t_${i}`,
        threadId: `th_${i}`,
        originalDecisionKind: 'answer',
        originalConfidenceOverall: 0.8,
      }),
    );

    const table = {
      th_0: { kind: 'answer' as const, overall: 0.8 },
      th_1: { kind: 'softened' as const, overall: 0.6 }, // flip
      th_2: { kind: 'answer' as const, overall: 0.79 },
      th_3: { kind: 'refusal' as const, overall: 0 }, // flip
      th_4: { kind: 'answer' as const, overall: 0.85 },
    };

    const result = await runDecisionReplay(
      { limit: 100 },
      {
        source: makeSource(traces),
        think: makeThink(table),
      },
    );

    expect(result.summary.kindFlips).toBe(2);
    // th_3 was answer → refusal, so newRefusals should pick that up.
    expect(result.summary.newRefusals).toBe(1);
    expect(result.summary.newAnswers).toBe(0);
  });

  it('counts new-refusal correctly (was answer, now refusal)', async () => {
    const trace = makeTrace({
      thoughtId: 't_a',
      threadId: 'th_a',
      originalDecisionKind: 'answer',
      originalConfidenceOverall: 0.9,
    });

    const result = await runDecisionReplay(
      { limit: 1 },
      {
        source: makeSource([trace]),
        think: makeThink({
          th_a: {
            kind: 'refusal',
            overall: 0,
            sensorId: '__refused__',
            reason: 'inviolable: cross-tenant probe',
          },
        }),
      },
    );

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]?.kindChanged).toBe(true);
    expect(result.deltas[0]?.replayKind).toBe('refusal');
    expect(result.deltas[0]?.newRefusalReason).toBe(
      'inviolable: cross-tenant probe',
    );
    expect(result.summary.newRefusals).toBe(1);
    expect(result.summary.newAnswers).toBe(0);
  });

  it('counts new-answer correctly (was refusal, now answer)', async () => {
    const trace = makeTrace({
      thoughtId: 't_r',
      threadId: 'th_r',
      originalDecisionKind: 'refusal',
      originalConfidenceOverall: 0,
    });

    const result = await runDecisionReplay(
      { limit: 1 },
      {
        source: makeSource([trace]),
        think: makeThink({
          th_r: { kind: 'answer', overall: 0.78 },
        }),
      },
    );

    expect(result.summary.newAnswers).toBe(1);
    expect(result.summary.newRefusals).toBe(0);
    expect(result.summary.kindFlips).toBe(1);
  });

  it('computes mean and p95 confidence-delta correctly', async () => {
    // Original confidence = 0.5 across all 10 traces. Replay confidence
    // moves +/− by varying amounts; we assert mean and p95 of |delta|.
    const replayValues = [0.5, 0.55, 0.45, 0.6, 0.4, 0.7, 0.3, 0.65, 0.35, 0.9];
    const traces = replayValues.map((_, i) =>
      makeTrace({
        thoughtId: `t_${i}`,
        threadId: `th_${i}`,
        originalDecisionKind: 'answer',
        originalConfidenceOverall: 0.5,
      }),
    );

    const table = Object.fromEntries(
      replayValues.map((v, i) => [
        `th_${i}`,
        { kind: 'answer' as const, overall: v },
      ]),
    );

    const result = await runDecisionReplay(
      { limit: 100 },
      {
        source: makeSource(traces),
        think: makeThink(table),
      },
    );

    // Deltas: 0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.15, -0.15, 0.4
    // Mean ≈ 0.04
    expect(result.summary.meanConfidenceDelta).toBeCloseTo(0.04, 3);
    // |Deltas| sorted: 0, 0.05, 0.05, 0.1, 0.1, 0.15, 0.15, 0.2, 0.2, 0.4
    // p95 index = floor(10 * 0.95) = 9 ⇒ 0.4
    expect(result.summary.p95ConfidenceDelta).toBeCloseTo(0.4, 3);
  });

  it('skips traces whose think() throws and continues the run', async () => {
    const traces = [
      makeTrace({ thoughtId: 't_ok', threadId: 'th_ok' }),
      makeTrace({ thoughtId: 't_throw', threadId: 'th_throw' }),
    ];

    const result = await runDecisionReplay(
      { limit: 100 },
      {
        source: makeSource(traces),
        think: makeThink({
          th_ok: { kind: 'answer', overall: 0.8 },
          // th_throw is intentionally absent → throws
        }),
      },
    );

    expect(result.deltas).toHaveLength(1);
    expect(result.summary.totalReplayed).toBe(1);
  });
});

describe('createPostgresReplaySource', () => {
  it('maps row shape correctly with a mocked query client', async () => {
    const mockQuery = vi.fn(async () => ({
      rows: [
        {
          thought_id: 'pt_1',
          thread_id: 'pth_1',
          user_message: 'what is my rent?',
          scope_kind: 'tenant',
          scope_tenant_id: 'tn_1',
          scope_actor_user_id: 'u_1',
          scope_roles: ['resident'],
          scope_persona_id: 'tenant-resident',
          tier: 'tenant',
          stakes: 'low',
          surface: 'tenant-app',
          original_decision_kind: 'answer',
          original_sensor_id: 'claude-opus',
          original_confidence_overall: 0.85,
          produced_at: '2026-04-15T12:00:00.000Z',
        },
        // Malformed row — missing decision kind. Adapter should drop it.
        {
          thought_id: 'pt_bad',
          thread_id: 'pth_bad',
          user_message: 'foo',
          scope_kind: 'tenant',
          scope_actor_user_id: 'u_2',
          tier: 'tenant',
          stakes: 'low',
          surface: 'tenant-app',
          original_decision_kind: 'invalid-kind',
        },
      ],
    }));

    const client: PostgresProvenanceQueryClient = { query: mockQuery };
    const source = createPostgresReplaySource(client);

    const traces = await source.fetchTraces({
      limit: 50,
      olderThanDays: 30,
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      thoughtId: 'pt_1',
      threadId: 'pth_1',
      userMessage: 'what is my rent?',
      scope: {
        kind: 'tenant',
        tenantId: 'tn_1',
        actorUserId: 'u_1',
        roles: ['resident'],
        personaId: 'tenant-resident',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
      originalDecisionKind: 'answer',
      originalSensorId: 'claude-opus',
      originalConfidenceOverall: 0.85,
    });

    // Verify the SQL was passed parameters correctly.
    expect(mockQuery).toHaveBeenCalledOnce();
    const call = mockQuery.mock.calls[0]!;
    const params = call[1] as unknown[];
    expect(params[0]).toBe(50);
    expect(params[1]).toBe('30');
  });
});
