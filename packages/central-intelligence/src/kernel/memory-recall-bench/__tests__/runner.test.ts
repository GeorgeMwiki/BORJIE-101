/**
 * Memory Recall Bench — tests.
 *
 * Phase D fix-wave (A4). Drives the bench against in-memory fakes for
 * all four tiers and checks:
 *
 *   - exact-match accounting (id-in-top-k)
 *   - token-F1 floor on a known-good corpus
 *   - graceful degradation on missing tiers / failing ports
 *   - seeder writes the right shape per tier
 *   - tokeniser invariants (locale-agnostic, lowercased, no empty toks)
 */

import { describe, it, expect } from 'vitest';
import { runRecallBench, seedRecallCorpus, tokenF1, tokenise } from '../index.js';
import type {
  EpisodicEntry,
  EpisodicMemoryPort,
  EpisodicRecordArgs,
  MemoryHierarchy,
  ProceduralMemoryPort,
  ProceduralPattern,
  ProceduralRecordArgs,
  ReflectiveDigest,
  ReflectiveDigestInput,
  ReflectiveMemoryPort,
  SemanticFact,
  SemanticMemoryPort,
  SemanticUpsertArgs,
} from '../../memory/types.js';
import type { RecallSample } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// In-memory fakes (per-tier). Each fake honours the sample.id so the
// bench can score exact-match accurately.
// ─────────────────────────────────────────────────────────────────────

function makeEpisodic(): {
  port: EpisodicMemoryPort;
  records: EpisodicRecordArgs[];
} {
  const records: EpisodicRecordArgs[] = [];
  const port: EpisodicMemoryPort = {
    async record(args) {
      records.push(args);
    },
    async recall(args) {
      // Build EpisodicEntry rows from the captured args; id = turnId so
      // the bench's exact-match scoring matches sample.id.
      const filtered = records.filter(
        (r) =>
          r.tenantId === args.tenantId &&
          r.userId === args.userId,
      );
      const rows: EpisodicEntry[] = filtered.map((r) => ({
        id: r.turnId.replace(/-turn$/, ''),
        tenantId: r.tenantId,
        userId: r.userId,
        threadId: r.threadId,
        turnId: r.turnId,
        kind: r.kind,
        summary: r.summary,
        payload: r.payload ?? {},
        capturedAt: '2026-05-18T00:00:00.000Z',
        expiresAt: null,
      }));
      return args.limit ? rows.slice(0, args.limit) : rows;
    },
    async purgeExpired() {
      return 0;
    },
  };
  return { port, records };
}

function makeSemantic(): { port: SemanticMemoryPort; facts: SemanticFact[] } {
  const facts: SemanticFact[] = [];
  const port: SemanticMemoryPort = {
    async upsertFact(args: SemanticUpsertArgs) {
      // id = key for deterministic matching against sample.id.
      const existingIdx = facts.findIndex(
        (f) =>
          f.tenantId === args.tenantId &&
          (f.userId ?? null) === (args.userId ?? null) &&
          f.key === args.key,
      );
      const row: SemanticFact = {
        id: args.key,
        tenantId: args.tenantId,
        userId: args.userId ?? null,
        key: args.key,
        value: args.value,
        confidence: args.confidence,
        sourceTurnId: args.sourceTurnId ?? null,
        evidenceCount: 1,
        firstSeenAt: '2026-05-18T00:00:00.000Z',
        lastSeenAt: '2026-05-18T00:00:00.000Z',
        expiresAt: null,
        source: args.source ?? 'extracted',
      };
      if (existingIdx >= 0) facts[existingIdx] = row;
      else facts.push(row);
    },
    async lookup(args) {
      return (
        facts.find(
          (f) =>
            f.tenantId === args.tenantId &&
            (f.userId ?? null) === (args.userId ?? null) &&
            f.key === args.key,
        ) ?? null
      );
    },
    async search(args) {
      const filtered = facts.filter(
        (f) =>
          f.tenantId === args.tenantId &&
          (f.userId ?? null) === (args.userId ?? null) &&
          (!args.prefix || f.key.startsWith(args.prefix)),
      );
      return args.limit ? filtered.slice(0, args.limit) : filtered;
    },
    async decay() {
      return 0;
    },
  };
  return { port, facts };
}

function makeProcedural(): {
  port: ProceduralMemoryPort;
  records: ProceduralRecordArgs[];
} {
  const records: ProceduralRecordArgs[] = [];
  const port: ProceduralMemoryPort = {
    async record(args) {
      records.push(args);
    },
    async match(args) {
      const lowered = args.userMessage.toLowerCase();
      const matches: ProceduralPattern[] = records
        .filter(
          (r) =>
            r.tenantId === args.tenantId &&
            r.userId === args.userId &&
            r.triggerKeywords.some((kw) => lowered.includes(kw.toLowerCase())),
        )
        .map((r) => ({
          id: r.patternName,
          tenantId: r.tenantId,
          userId: r.userId,
          patternName: r.patternName,
          toolSequence: r.toolSequence,
          triggerKeywords: r.triggerKeywords,
          invocations: 1,
          successes: r.success ? 1 : 0,
          successRate: r.success ? 1 : 0,
          lastInvokedAt: null,
          createdAt: '2026-05-18T00:00:00.000Z',
        }));
      return args.limit ? matches.slice(0, args.limit) : matches;
    },
  };
  return { port, records };
}

function makeReflective(): {
  port: ReflectiveMemoryPort;
  digests: ReflectiveDigest[];
} {
  const digests: ReflectiveDigest[] = [];
  const port: ReflectiveMemoryPort = {
    async record(input: ReflectiveDigestInput) {
      digests.push({
        id: input.summary.slice(0, 20),
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        periodKind: input.periodKind,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        summary: input.summary,
        topTopics: input.topTopics ?? [],
        sentimentAvg: input.sentimentAvg ?? null,
        actionItems: input.actionItems ?? [],
        generatedAt: '2026-05-18T00:00:00.000Z',
      });
    },
    async latest(args) {
      const filtered = digests.filter(
        (d) =>
          d.tenantId === args.tenantId &&
          (d.userId ?? null) === (args.userId ?? null) &&
          d.periodKind === args.periodKind,
      );
      return args.n ? filtered.slice(0, args.n) : filtered;
    },
  };
  return { port, digests };
}

function makeMemory(): MemoryHierarchy {
  return {
    episodic: makeEpisodic().port,
    semantic: makeSemantic().port,
    procedural: makeProcedural().port,
    reflective: makeReflective().port,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Corpus — 1 sample per tier; deliberately small so the test stays
// deterministic + fast.
// ─────────────────────────────────────────────────────────────────────

const CORPUS: ReadonlyArray<RecallSample> = [
  {
    id: 'language.preferred',
    tier: 'semantic',
    tenantId: 't_demo',
    userId: 'u_alice',
    fact: { key: 'language.preferred', value: 'Swahili', source: 'declared' },
    query: 'What language does Alice prefer?',
    expectedAnswer: 'Swahili',
  },
  {
    id: 'turn-001',
    tier: 'episodic',
    tenantId: 't_demo',
    userId: 'u_alice',
    fact: {
      threadId: 'thread-1',
      turnId: 'turn-001-turn',
      kind: 'user-message',
      summary: 'Asked about rent due date for unit 12B',
    },
    query: 'When was rent for unit 12B last discussed?',
    expectedAnswer: 'rent due date unit 12B',
  },
  {
    id: 'check-arrears-pattern',
    tier: 'procedural',
    tenantId: 't_demo',
    userId: 'u_alice',
    fact: {
      patternName: 'check-arrears-pattern',
      toolSequence: ['platform.list_arrears', 'platform.send_reminder'],
      triggerKeywords: ['arrears', 'reminder'],
    },
    query: 'I need to send a reminder for arrears',
    expectedAnswer: 'list_arrears send_reminder',
  },
  {
    id: 'Weekly vacancy spike',
    tier: 'reflective',
    tenantId: 't_demo',
    userId: 'u_alice',
    fact: {
      periodKind: 'weekly',
      periodStart: '2026-05-11T00:00:00Z',
      periodEnd: '2026-05-18T00:00:00Z',
      summary: 'Weekly vacancy spike: 14 unit inquiries unanswered.',
    },
    query: 'How was vacancy last week?',
    expectedAnswer: 'Weekly vacancy spike 14 unit inquiries',
  },
];

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('tokenise', () => {
  it('lowercases + splits on non-word chars + drops empty tokens', () => {
    const toks = tokenise('  Hello,   World! 123  ');
    expect(toks).toEqual(['hello', 'world', '123']);
  });

  it('handles unicode letters (Swahili)', () => {
    const toks = tokenise('Habari ya leo');
    expect(toks).toEqual(['habari', 'ya', 'leo']);
  });

  it('returns empty array for empty / non-string input', () => {
    expect(tokenise('')).toEqual([]);
    // @ts-expect-error — intentional non-string
    expect(tokenise(undefined)).toEqual([]);
  });
});

describe('tokenF1', () => {
  it('returns 1.0 for identical bags', () => {
    expect(tokenF1('rent due unit 12B', 'rent due unit 12B')).toBe(1);
  });

  it('returns 0 for fully disjoint bags', () => {
    expect(tokenF1('alpha beta', 'gamma delta')).toBe(0);
  });

  it('handles partial overlap (precision + recall)', () => {
    // expected = [rent, due], actual = [rent, paid] -> 1 common, P=0.5 R=0.5 F1=0.5
    expect(tokenF1('rent due', 'rent paid')).toBeCloseTo(0.5, 4);
  });

  it('returns 0 when either side is empty', () => {
    expect(tokenF1('', 'rent')).toBe(0);
    expect(tokenF1('rent', '')).toBe(0);
  });
});

describe('runRecallBench', () => {
  it('seeds + recalls + scores all four tiers (exact-match 1.0)', async () => {
    const memory = makeMemory();
    await seedRecallCorpus(memory, CORPUS);
    const report = await runRecallBench({ memory, samples: CORPUS });

    expect(report.totals.samples).toBe(4);
    expect(report.totals.exactMatch).toBe(1);
    expect(report.totals.tokenF1).toBeGreaterThan(0.4);
    expect(report.perTier.map((t) => t.tier).sort()).toEqual([
      'episodic',
      'procedural',
      'reflective',
      'semantic',
    ]);
    for (const tier of report.perTier) {
      expect(tier.exactMatch).toBe(1);
      expect(tier.samples).toBe(1);
    }
  });

  it('reports 0 exact-match when seeder is skipped', async () => {
    const memory = makeMemory();
    // Intentionally do NOT seed.
    const report = await runRecallBench({ memory, samples: CORPUS });

    expect(report.totals.exactMatch).toBe(0);
    expect(report.totals.tokenF1).toBe(0);
  });

  it('degrades gracefully when a tier port is missing', async () => {
    const partial: MemoryHierarchy = { semantic: makeSemantic().port };
    await seedRecallCorpus(partial, CORPUS);
    const report = await runRecallBench({ memory: partial, samples: CORPUS });

    // Only the semantic sample can match.
    const semanticTier = report.perTier.find((t) => t.tier === 'semantic');
    expect(semanticTier?.exactMatch).toBe(1);
    const episodicTier = report.perTier.find((t) => t.tier === 'episodic');
    expect(episodicTier?.exactMatch).toBe(0);
  });

  it('handles a failing port without throwing', async () => {
    const memory: MemoryHierarchy = {
      semantic: {
        async upsertFact() {
          /* noop */
        },
        async lookup() {
          throw new Error('boom');
        },
        async search() {
          throw new Error('boom');
        },
        async decay() {
          return 0;
        },
      },
    };
    const report = await runRecallBench({
      memory,
      samples: [CORPUS[0]],
    });
    expect(report.totals.samples).toBe(1);
    expect(report.totals.exactMatch).toBe(0);
    expect(report.perSample[0]?.matched).toBe(false);
  });

  it('returns an empty report for an empty corpus', async () => {
    const memory = makeMemory();
    const report = await runRecallBench({ memory, samples: [] });
    expect(report.totals.samples).toBe(0);
    expect(report.totals.exactMatch).toBe(0);
    expect(report.totals.tokenF1).toBe(0);
    expect(report.perTier).toEqual([]);
    expect(report.perSample).toEqual([]);
  });

  it('honours the topK option (limits recall scope)', async () => {
    const memory = makeMemory();
    // Seed two extra semantic facts so search returns multiple rows.
    await seedRecallCorpus(memory, [
      ...CORPUS,
      {
        id: 'language.secondary',
        tier: 'semantic',
        tenantId: 't_demo',
        userId: 'u_alice',
        fact: { key: 'language.secondary', value: 'English' },
        query: 'Secondary language?',
        expectedAnswer: 'English',
      },
    ]);
    const report = await runRecallBench({
      memory,
      samples: CORPUS,
      options: { topK: 1 },
    });
    expect(report.totals.samples).toBe(4);
    // Semantic lookup is exact-by-key, so topK=1 still finds the target.
    const semanticPer = report.perSample.filter((p) => p.tier === 'semantic');
    expect(semanticPer.every((p) => p.matched)).toBe(true);
  });
});

describe('seedRecallCorpus', () => {
  it('writes the right number of rows per tier', async () => {
    const epi = makeEpisodic();
    const sem = makeSemantic();
    const proc = makeProcedural();
    const refl = makeReflective();
    const memory: MemoryHierarchy = {
      episodic: epi.port,
      semantic: sem.port,
      procedural: proc.port,
      reflective: refl.port,
    };
    await seedRecallCorpus(memory, CORPUS);
    expect(epi.records).toHaveLength(1);
    expect(sem.facts).toHaveLength(1);
    expect(proc.records).toHaveLength(1);
    expect(refl.digests).toHaveLength(1);
  });

  it('is a no-op when no port is bound', async () => {
    await seedRecallCorpus({}, CORPUS);
    // Reaching here without throwing is the assertion.
    expect(true).toBe(true);
  });
});
