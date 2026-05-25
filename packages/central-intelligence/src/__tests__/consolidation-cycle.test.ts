/**
 * Consolidation cycle unit tests.
 *
 * Mocks all four memory ports + the Haiku judge port; asserts:
 *   1. empty episodic input → no fact extraction call, all counts zero
 *   2. judge returns 3 facts → 3 upserts called with correct keys
 *   3. judge returns invalid JSON → cycle does not throw; returns 0
 *   4. procedural pattern detected (3-tool seq, 2x) → 1 record
 *   5. procedural pattern NOT detected → 0 records
 *   6. weekly digest generated and stored
 *   7. daily run does NOT generate weekly digest
 *   8. purgeExpired called once per cycle
 *   9. semantic.decay called when applyDecay=true
 *  10. judge throw is caught and reported in errors array
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runConsolidationCycle,
  type ConsolidationDeps,
  type ConsolidationJudgePort,
  type ConsolidationScope,
} from '../kernel/consolidation/index.js';
import type {
  EpisodicEntry,
  EpisodicMemoryPort,
  ProceduralMemoryPort,
  ReflectiveMemoryPort,
  SemanticMemoryPort,
} from '../kernel/memory/index.js';

const TENANT = 't_demo';
const USER = 'u_alice';

const SCOPE_DAILY: ConsolidationScope = {
  tenantId: TENANT,
  userId: USER,
  periodKind: 'daily',
};

const SCOPE_WEEKLY: ConsolidationScope = {
  tenantId: TENANT,
  userId: USER,
  periodKind: 'weekly',
};

function makeEntry(
  overrides: Partial<EpisodicEntry> & Pick<EpisodicEntry, 'kind' | 'summary'>,
): EpisodicEntry {
  return {
    id: overrides.id ?? `ep_${Math.random().toString(36).slice(2, 10)}`,
    tenantId: overrides.tenantId ?? TENANT,
    userId: overrides.userId ?? USER,
    threadId: overrides.threadId ?? 'thr_1',
    turnId: overrides.turnId ?? `tn_${Math.random().toString(36).slice(2, 10)}`,
    kind: overrides.kind,
    summary: overrides.summary,
    payload: overrides.payload ?? {},
    capturedAt: overrides.capturedAt ?? new Date().toISOString(),
    expiresAt: overrides.expiresAt ?? null,
  };
}

function makeDeps(opts: {
  entries?: ReadonlyArray<EpisodicEntry>;
  judgeBody?: string;
  judgeImpl?: ConsolidationJudgePort['call'];
  purgeReturns?: number;
  decayReturns?: number;
}): {
  deps: ConsolidationDeps;
  episodic: { recall: ReturnType<typeof vi.fn>; purgeExpired: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> };
  semantic: {
    upsertFact: ReturnType<typeof vi.fn>;
    decay: ReturnType<typeof vi.fn>;
    lookup: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
  procedural: { record: ReturnType<typeof vi.fn>; match: ReturnType<typeof vi.fn> };
  reflective: { record: ReturnType<typeof vi.fn>; latest: ReturnType<typeof vi.fn> };
  judge: { call: ReturnType<typeof vi.fn> };
  warns: string[];
} {
  const entries = opts.entries ?? [];
  const purgeReturns = opts.purgeReturns ?? 0;
  const decayReturns = opts.decayReturns ?? 0;

  const episodicMock = {
    recall: vi.fn().mockResolvedValue(entries),
    purgeExpired: vi.fn().mockResolvedValue(purgeReturns),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const semanticMock = {
    upsertFact: vi.fn().mockResolvedValue(undefined),
    lookup: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue([]),
    decay: vi.fn().mockResolvedValue(decayReturns),
  };
  const proceduralMock = {
    record: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue([]),
  };
  const reflectiveMock = {
    record: vi.fn().mockResolvedValue(undefined),
    latest: vi.fn().mockResolvedValue([]),
  };
  const judgeImpl =
    opts.judgeImpl ??
    vi.fn(async () => opts.judgeBody ?? '[]');
  const judgeMock = {
    call: vi.fn(judgeImpl as never),
  };
  const warns: string[] = [];
  const logger = {
    warn(msg: string) {
      warns.push(msg);
    },
  };

  const deps: ConsolidationDeps = {
    episodic: episodicMock as unknown as EpisodicMemoryPort,
    semantic: semanticMock as unknown as SemanticMemoryPort,
    procedural: proceduralMock as unknown as ProceduralMemoryPort,
    reflective: reflectiveMock as unknown as ReflectiveMemoryPort,
    judge: judgeMock as unknown as ConsolidationJudgePort,
    logger,
  };
  return {
    deps,
    episodic: episodicMock,
    semantic: semanticMock,
    procedural: proceduralMock,
    reflective: reflectiveMock,
    judge: judgeMock,
    warns,
  };
}

describe('runConsolidationCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('empty episodic input → no fact extraction call, all counts zero', async () => {
    const { deps, judge, semantic, procedural, reflective } = makeDeps({ entries: [] });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(judge.call).not.toHaveBeenCalled();
    expect(semantic.upsertFact).not.toHaveBeenCalled();
    expect(procedural.record).not.toHaveBeenCalled();
    expect(reflective.record).not.toHaveBeenCalled();

    expect(report.episodicConsidered).toBe(0);
    expect(report.factsExtracted).toBe(0);
    expect(report.factsUpserted).toBe(0);
    expect(report.patternsRecorded).toBe(0);
    expect(report.digestsWritten).toBe(0);
  });

  it('judge returns 3 facts → 3 upserts called with correct keys', async () => {
    const entries = [
      makeEntry({ kind: 'user-message', summary: 'I prefer SMS notifications.' }),
      makeEntry({ kind: 'agent-action', summary: 'Acknowledged.' }),
    ];
    const factsJson = JSON.stringify([
      { key: 'preferred_channel', value: 'sms', confidence: 0.9, evidence: 'I prefer SMS' },
      { key: 'tenancy_status', value: 'active', confidence: 0.7, evidence: 'active lease' },
      { key: 'pet_owner', value: 'true', confidence: 0.6, evidence: 'mentioned cat' },
    ]);
    const { deps, semantic } = makeDeps({ entries, judgeBody: factsJson });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.factsExtracted).toBe(3);
    expect(report.factsUpserted).toBe(3);
    expect(semantic.upsertFact).toHaveBeenCalledTimes(3);
    const keys = semantic.upsertFact.mock.calls.map((c) => c[0].key);
    expect(keys).toEqual(['preferred_channel', 'tenancy_status', 'pet_owner']);
    // Each upsert carries tenant + user + source='consolidated'.
    for (const call of semantic.upsertFact.mock.calls) {
      expect(call[0].tenantId).toBe(TENANT);
      expect(call[0].userId).toBe(USER);
      expect(call[0].source).toBe('consolidated');
    }
  });

  it('judge returns invalid JSON → cycle does not throw; logs warn and returns 0 extracted', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hello' })];
    const { deps, semantic, warns } = makeDeps({
      entries,
      judgeBody: 'this is not JSON at all',
    });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.factsExtracted).toBe(0);
    expect(report.factsUpserted).toBe(0);
    expect(semantic.upsertFact).not.toHaveBeenCalled();
    expect(warns.some((w) => w.includes('fact-extraction'))).toBe(true);
    // Errors array should be empty — invalid JSON is a soft failure.
    expect(report.errors.length).toBe(0);
  });

  it('procedural pattern detected (same 3-tool sequence, 2 occurrences) → 1 record', async () => {
    // recall() returns descending (newest-first); the cycle reverses to
    // chronological internally. We mirror the recall contract by writing
    // newest-first here (the second pass appears before the first).
    const entries = [
      makeEntry({ kind: 'agent-action', summary: 'send_notice', payload: { toolName: 'send_notice' } }),
      makeEntry({ kind: 'agent-action', summary: 'compute_arrears', payload: { toolName: 'compute_arrears' } }),
      makeEntry({ kind: 'agent-action', summary: 'lookup_lease', payload: { toolName: 'lookup_lease' } }),
      makeEntry({ kind: 'user-message', summary: 'do it again for B7' }),
      makeEntry({ kind: 'agent-action', summary: 'send_notice', payload: { toolName: 'send_notice' } }),
      makeEntry({ kind: 'agent-action', summary: 'compute_arrears', payload: { toolName: 'compute_arrears' } }),
      makeEntry({ kind: 'agent-action', summary: 'lookup_lease', payload: { toolName: 'lookup_lease' } }),
      makeEntry({ kind: 'user-message', summary: 'check arrears for unit A12' }),
    ];
    const { deps, procedural } = makeDeps({ entries, judgeBody: '[]' });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.patternsRecorded).toBe(1);
    expect(procedural.record).toHaveBeenCalledTimes(1);
    const call = procedural.record.mock.calls[0][0];
    expect(call.tenantId).toBe(TENANT);
    expect(call.userId).toBe(USER);
    expect(call.toolSequence).toEqual(['lookup_lease', 'compute_arrears', 'send_notice']);
    expect(call.success).toBe(true);
    // Trigger keywords drawn from the FIRST anchor user message.
    expect(call.triggerKeywords.length).toBeGreaterThan(0);
  });

  it('procedural pattern NOT detected (different sequences) → 0 records', async () => {
    // Newest-first per the recall contract.
    const entries = [
      makeEntry({ kind: 'agent-action', summary: 'tool_z', payload: { toolName: 'tool_z' } }),
      makeEntry({ kind: 'agent-action', summary: 'tool_y', payload: { toolName: 'tool_y' } }),
      makeEntry({ kind: 'agent-action', summary: 'tool_x', payload: { toolName: 'tool_x' } }),
      makeEntry({ kind: 'user-message', summary: 'second request' }),
      makeEntry({ kind: 'agent-action', summary: 'tool_c', payload: { toolName: 'tool_c' } }),
      makeEntry({ kind: 'agent-action', summary: 'tool_b', payload: { toolName: 'tool_b' } }),
      makeEntry({ kind: 'agent-action', summary: 'tool_a', payload: { toolName: 'tool_a' } }),
      makeEntry({ kind: 'user-message', summary: 'first request' }),
    ];
    const { deps, procedural } = makeDeps({ entries, judgeBody: '[]' });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.patternsRecorded).toBe(0);
    expect(procedural.record).not.toHaveBeenCalled();
  });

  it('weekly digest generated and stored', async () => {
    const entries = [
      makeEntry({ kind: 'user-message', summary: 'busy week, lots of arrears' }),
      makeEntry({ kind: 'agent-action', summary: 'helped' }),
    ];
    // First judge call is fact-extraction → []; second is digest → object.
    const calls: string[] = [];
    const judgeImpl: ConsolidationJudgePort['call'] = async ({ system }) => {
      calls.push(system.slice(0, 60));
      if (system.includes('memory consolidation judge')) return '[]';
      // digest
      return JSON.stringify({
        summary: 'A busy week focused on arrears chasing.',
        top_topics: [
          { topic: 'arrears', count: 5 },
          { topic: 'units', count: 2 },
        ],
        sentiment_avg: -0.2,
        action_items: ['follow up on B7 arrears'],
      });
    };
    const { deps, reflective } = makeDeps({ entries, judgeImpl });

    const report = await runConsolidationCycle(deps, SCOPE_WEEKLY);

    expect(report.digestsWritten).toBe(1);
    expect(reflective.record).toHaveBeenCalledTimes(1);
    const recorded = reflective.record.mock.calls[0][0];
    expect(recorded.tenantId).toBe(TENANT);
    expect(recorded.userId).toBe(USER);
    expect(recorded.periodKind).toBe('weekly');
    expect(recorded.summary).toContain('busy week');
    expect(recorded.topTopics).toEqual([
      { topic: 'arrears', count: 5 },
      { topic: 'units', count: 2 },
    ]);
    expect(recorded.sentimentAvg).toBe(-0.2);
    expect(recorded.actionItems).toEqual(['follow up on B7 arrears']);
  });

  it('daily run does NOT generate weekly digest (period mismatch)', async () => {
    const entries = [
      makeEntry({ kind: 'user-message', summary: 'something' }),
      makeEntry({ kind: 'agent-action', summary: 'replied' }),
    ];
    const { deps, reflective, judge } = makeDeps({
      entries,
      judgeBody: '[]',
    });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.digestsWritten).toBe(0);
    expect(reflective.record).not.toHaveBeenCalled();
    // Judge was called once for fact-extraction only — never for digest.
    expect(judge.call).toHaveBeenCalledTimes(1);
  });

  it('purgeExpired called once per cycle', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hi' })];
    const { deps, episodic } = makeDeps({
      entries,
      judgeBody: '[]',
      purgeReturns: 7,
    });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(episodic.purgeExpired).toHaveBeenCalledTimes(1);
    expect(report.expiredPurged).toBe(7);
  });

  it('semantic.decay invoked when applyDecay=true (default)', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hi' })];
    const { deps, semantic } = makeDeps({
      entries,
      judgeBody: '[]',
      decayReturns: 4,
    });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(semantic.decay).toHaveBeenCalledTimes(1);
    const decayArg = semantic.decay.mock.calls[0][0];
    expect(decayArg.tenantId).toBe(TENANT);
    expect(decayArg.decayPerDay).toBeGreaterThan(0);
    expect(report.decayedFacts).toBe(4);
  });

  it('judge throwing is caught and surfaced in errors array', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hello' })];
    const judgeImpl: ConsolidationJudgePort['call'] = async () => {
      throw new Error('upstream-503');
    };
    const { deps, semantic, warns } = makeDeps({ entries, judgeImpl });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY);

    expect(report.factsExtracted).toBe(0);
    expect(report.factsUpserted).toBe(0);
    expect(semantic.upsertFact).not.toHaveBeenCalled();
    expect(report.errors.some((e) => e.includes('upstream-503'))).toBe(true);
    expect(warns.length).toBeGreaterThan(0);
  });

  it('null userId scope skips fact extraction and procedural detection but still purges + decays', async () => {
    const { deps, episodic, semantic, judge, procedural } = makeDeps({
      entries: [],
      judgeBody: '[]',
      purgeReturns: 2,
    });

    const report = await runConsolidationCycle(deps, {
      tenantId: TENANT,
      userId: null,
      periodKind: 'daily',
    });

    expect(judge.call).not.toHaveBeenCalled();
    expect(episodic.recall).not.toHaveBeenCalled();
    expect(procedural.record).not.toHaveBeenCalled();
    expect(episodic.purgeExpired).toHaveBeenCalledTimes(1);
    expect(semantic.decay).toHaveBeenCalledTimes(1);
    expect(report.expiredPurged).toBe(2);
  });

  it('low-confidence facts are filtered by minFactConfidence', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hi' })];
    const factsJson = JSON.stringify([
      { key: 'k1', value: 'v1', confidence: 0.9, evidence: '...' },
      { key: 'k2', value: 'v2', confidence: 0.2, evidence: '...' },
    ]);
    const { deps, semantic } = makeDeps({ entries, judgeBody: factsJson });

    const report = await runConsolidationCycle(deps, SCOPE_DAILY, {
      minFactConfidence: 0.5,
    });

    expect(report.factsExtracted).toBe(2);
    expect(report.factsUpserted).toBe(1);
    expect(semantic.upsertFact).toHaveBeenCalledTimes(1);
    expect(semantic.upsertFact.mock.calls[0][0].key).toBe('k1');
  });
});
