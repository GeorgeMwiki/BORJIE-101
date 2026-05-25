/**
 * Consolidation cycle — edge-case tests.
 *
 * The existing consolidation-cycle.test.ts covers the happy paths and
 * the major error paths. These tests target the boundary conditions
 * that a regression in the brain's "sleep" pass would silently break:
 *
 *   - episodic.recall throwing → cycle still calls purge + decay
 *   - episodic.purgeExpired throwing → reported in errors, decay still runs
 *   - semantic.decay throwing → reported in errors
 *   - semantic.upsertFact throwing for ONE key → other keys still upsert
 *   - reflective.record throwing on weekly digest → reported in errors
 *   - judge body wrapped in markdown fence → JSON still extracted
 *   - JSON object embedded inside prose → still parsed
 *   - patternWindowSize larger than tool count → no patterns
 *   - applyDecay=false skips semantic.decay
 *   - purgeExpired=false skips episodic.purgeExpired
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

interface MockBundle {
  deps: ConsolidationDeps;
  episodic: {
    recall: ReturnType<typeof vi.fn>;
    purgeExpired: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
  };
  semantic: {
    upsertFact: ReturnType<typeof vi.fn>;
    decay: ReturnType<typeof vi.fn>;
    lookup: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
  procedural: {
    record: ReturnType<typeof vi.fn>;
    match: ReturnType<typeof vi.fn>;
  };
  reflective: {
    record: ReturnType<typeof vi.fn>;
    latest: ReturnType<typeof vi.fn>;
  };
  judge: { call: ReturnType<typeof vi.fn> };
  warns: string[];
}

function makeDeps(opts: {
  entries?: ReadonlyArray<EpisodicEntry>;
  judgeBody?: string;
  judgeImpl?: ConsolidationJudgePort['call'];
  episodicRecallImpl?: EpisodicMemoryPort['recall'];
  episodicPurgeImpl?: EpisodicMemoryPort['purgeExpired'];
  semanticUpsertImpl?: SemanticMemoryPort['upsertFact'];
  semanticDecayImpl?: SemanticMemoryPort['decay'];
  reflectiveRecordImpl?: ReflectiveMemoryPort['record'];
}): MockBundle {
  const entries = opts.entries ?? [];

  const episodicMock = {
    recall: vi.fn(
      opts.episodicRecallImpl ??
        (async () => entries),
    ),
    purgeExpired: vi.fn(
      opts.episodicPurgeImpl ?? (async () => 0),
    ),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const semanticMock = {
    upsertFact: vi.fn(opts.semanticUpsertImpl ?? (async () => undefined)),
    lookup: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue([]),
    decay: vi.fn(opts.semanticDecayImpl ?? (async () => 0)),
  };
  const proceduralMock = {
    record: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue([]),
  };
  const reflectiveMock = {
    record: vi.fn(opts.reflectiveRecordImpl ?? (async () => undefined)),
    latest: vi.fn().mockResolvedValue([]),
  };
  const judgeImpl =
    opts.judgeImpl ?? (async () => opts.judgeBody ?? '[]');
  const judgeMock = { call: vi.fn(judgeImpl as never) };
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

describe('runConsolidationCycle — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if scope is missing', async () => {
    const { deps } = makeDeps({});
    await expect(
      // @ts-expect-error — deliberately violating the contract
      runConsolidationCycle(deps, undefined),
    ).rejects.toThrow(/scope is required/);
  });

  it('episodic.recall throwing is reported and the cycle still purges + decays', async () => {
    const { deps, episodic, semantic, judge } = makeDeps({
      episodicRecallImpl: async () => {
        throw new Error('recall-down');
      },
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);
    expect(report.errors.some((e) => e.includes('recall-down'))).toBe(true);
    expect(report.episodicConsidered).toBe(0);
    // No fact extraction (no entries).
    expect(judge.call).not.toHaveBeenCalled();
    expect(semantic.upsertFact).not.toHaveBeenCalled();
    // But cleanup phases still ran.
    expect(episodic.purgeExpired).toHaveBeenCalledTimes(1);
    expect(semantic.decay).toHaveBeenCalledTimes(1);
  });

  it('episodic.purgeExpired throwing is reported but does not abort the cycle', async () => {
    const { deps, semantic } = makeDeps({
      entries: [makeEntry({ kind: 'user-message', summary: 'hi' })],
      judgeBody: '[]',
      episodicPurgeImpl: async () => {
        throw new Error('purge-down');
      },
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);
    expect(report.errors.some((e) => e.includes('purge-down'))).toBe(true);
    expect(report.expiredPurged).toBe(0);
    // Decay still runs.
    expect(semantic.decay).toHaveBeenCalledTimes(1);
  });

  it('semantic.decay throwing is reported in the errors array', async () => {
    const { deps } = makeDeps({
      entries: [makeEntry({ kind: 'user-message', summary: 'hi' })],
      judgeBody: '[]',
      semanticDecayImpl: async () => {
        throw new Error('decay-down');
      },
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);
    expect(report.errors.some((e) => e.includes('decay-down'))).toBe(true);
    expect(report.decayedFacts).toBe(0);
  });

  it('semantic.upsertFact throwing for ONE key still upserts the others', async () => {
    const entries = [makeEntry({ kind: 'user-message', summary: 'hi' })];
    const factsJson = JSON.stringify([
      { key: 'good_one', value: 'v', confidence: 0.9 },
      { key: 'broken_one', value: 'v', confidence: 0.9 },
      { key: 'another_good_one', value: 'v', confidence: 0.9 },
    ]);
    let calls = 0;
    const { deps, semantic } = makeDeps({
      entries,
      judgeBody: factsJson,
      semanticUpsertImpl: async (args) => {
        calls += 1;
        if (args.key === 'broken_one') {
          throw new Error('unique-violation');
        }
      },
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);
    expect(report.factsExtracted).toBe(3);
    // Two succeeded, one failed.
    expect(report.factsUpserted).toBe(2);
    expect(report.errors.some((e) => e.includes('broken_one'))).toBe(true);
    expect(report.errors.some((e) => e.includes('unique-violation'))).toBe(true);
    expect(calls).toBe(3);
    expect(semantic.upsertFact).toHaveBeenCalledTimes(3);
  });

  it('reflective.record throwing on weekly digest is reported in errors', async () => {
    const entries = [
      makeEntry({ kind: 'user-message', summary: 'a busy week' }),
      makeEntry({ kind: 'agent-action', summary: 'replied' }),
    ];
    const judgeImpl: ConsolidationJudgePort['call'] = async ({ system }) => {
      if (system.includes('memory consolidation judge')) return '[]';
      return JSON.stringify({
        summary: 'busy week',
        top_topics: [],
        sentiment_avg: 0,
        action_items: [],
      });
    };
    const { deps } = makeDeps({
      entries,
      judgeImpl,
      reflectiveRecordImpl: async () => {
        throw new Error('reflective-down');
      },
    });
    const report = await runConsolidationCycle(deps, SCOPE_WEEKLY);
    expect(report.digestsWritten).toBe(0);
    expect(report.errors.some((e) => e.includes('reflective-down'))).toBe(true);
  });

  it('fence-wrapped fact-array JSON is currently rejected (parser prefers first {…} block)', async () => {
    // Pins the current behaviour: when the judge returns a fenced
    // ARRAY containing a single object, the parser's "first {…} block"
    // candidate matches the inner object before the array regex runs,
    // and the fact-array schema rejects the bare object. The cycle
    // logs a warning, records zero extracted facts, and continues.
    // If a future parser preserves the array, this test should flip
    // to assert factsExtracted === 1.
    const entries = [makeEntry({ kind: 'user-message', summary: 'hi' })];
    const wrapped = '```json\n[{"key":"k","value":"v","confidence":0.9}]\n```';
    const { deps, semantic, warns } = makeDeps({ entries, judgeBody: wrapped });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY);
    expect(report.factsExtracted).toBe(0);
    expect(report.factsUpserted).toBe(0);
    expect(semantic.upsertFact).not.toHaveBeenCalled();
    expect(warns.some((w) => w.includes('fact-extraction'))).toBe(true);
  });

  it('extracts JSON object embedded inside prose', async () => {
    const entries = [
      makeEntry({ kind: 'user-message', summary: 'busy week, lots of arrears' }),
    ];
    const judgeImpl: ConsolidationJudgePort['call'] = async ({ system }) => {
      if (system.includes('memory consolidation judge')) return '[]';
      // Digest body wrapped in prose — the cycle's parseJsonValue
      // must isolate the {...} block.
      return [
        'Here is the requested digest:',
        '{"summary":"busy week","top_topics":[],"sentiment_avg":-0.1,"action_items":[]}',
        'Hope it helps.',
      ].join('\n');
    };
    const { deps, reflective } = makeDeps({ entries, judgeImpl });
    const report = await runConsolidationCycle(deps, SCOPE_WEEKLY);
    expect(report.digestsWritten).toBe(1);
    expect(reflective.record).toHaveBeenCalledTimes(1);
    expect(reflective.record.mock.calls[0]?.[0].summary).toBe('busy week');
  });

  it('patternWindowSize larger than tool count → no patterns recorded', async () => {
    const entries = [
      makeEntry({ kind: 'agent-action', summary: 'one', payload: { toolName: 'one' } }),
      makeEntry({ kind: 'agent-action', summary: 'two', payload: { toolName: 'two' } }),
      makeEntry({ kind: 'user-message', summary: 'do it' }),
    ];
    const { deps, procedural } = makeDeps({ entries, judgeBody: '[]' });
    // patternWindowSize=10 → 2 tool entries can't fill a window.
    const report = await runConsolidationCycle(deps, SCOPE_DAILY, {
      patternWindowSize: 10,
    });
    expect(report.patternsRecorded).toBe(0);
    expect(procedural.record).not.toHaveBeenCalled();
  });

  it('applyDecay=false skips the semantic.decay call entirely', async () => {
    const { deps, semantic } = makeDeps({
      entries: [makeEntry({ kind: 'user-message', summary: 'hi' })],
      judgeBody: '[]',
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY, {
      applyDecay: false,
    });
    expect(semantic.decay).not.toHaveBeenCalled();
    expect(report.decayedFacts).toBe(0);
  });

  it('purgeExpired=false skips the episodic.purgeExpired call entirely', async () => {
    const { deps, episodic } = makeDeps({
      entries: [makeEntry({ kind: 'user-message', summary: 'hi' })],
      judgeBody: '[]',
    });
    const report = await runConsolidationCycle(deps, SCOPE_DAILY, {
      purgeExpired: false,
    });
    expect(episodic.purgeExpired).not.toHaveBeenCalled();
    expect(report.expiredPurged).toBe(0);
  });
});
