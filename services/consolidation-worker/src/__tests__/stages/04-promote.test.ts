/**
 * Stage 04 — promote unit tests.
 *
 * Coverage:
 *   1. success cluster with ≥3 traces and score≥0.5 → promote-skill
 *   2. success cluster with too few traces → no-op
 *   3. success cluster with score below threshold → no-op
 *   4. failure cluster → prompt-patch
 *   5. mixed cluster → no-op
 *   6. cluster without a reflection → no-op
 *   7. embedder is invoked when wired
 *   8. embedder failure → promote without embedding (no throw)
 *   9. registry upsert throw → logged, decision still emitted
 *   10. determinstic code_hash — same inputs produce same hash
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MIN_OCCURRENCES,
  MIN_SUCCESS_SCORE,
  runPromoteStage,
} from '../../stages/04-promote.js';
import type {
  ConsolidationEmbedder,
  ReflectionResult,
  SkillRegistryPort,
  StageLogger,
  TraceCluster,
} from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCluster(
  id: string,
  opts: {
    outcome?: TraceCluster['outcome'];
    score?: number;
    traces?: number;
    intent?: string;
  } = {},
): TraceCluster {
  const traces = Array.from({ length: opts.traces ?? 3 }, (_, i) => ({
    traceId: `${id}-t${i}`,
    tenantId: 't-1',
    userId: 'u-1',
    threadId: 'th',
    summary: 'x',
    capturedAt: new Date().toISOString(),
  }));
  return {
    clusterId: id,
    tenantId: 't-1',
    intentLabel: opts.intent ?? 'late-rent-reminder',
    traces,
    outcome: opts.outcome ?? 'success',
    score: opts.score ?? 0.7,
    signalsInside: 3,
  };
}

function makeReflection(clusterId: string): ReflectionResult {
  return {
    clusterId,
    tenantId: 't-1',
    text: `Reflection for ${clusterId}`,
    outcome: 'success',
    intentLabel: 'late-rent-reminder',
  };
}

function makeRegistry(opts: {
  failNext?: boolean;
} = {}): {
  port: SkillRegistryPort;
  calls: Array<{
    tenantId: string | null;
    name: string;
    codeHash: string;
    embedding?: ReadonlyArray<number>;
  }>;
} {
  const calls: Array<{
    tenantId: string | null;
    name: string;
    codeHash: string;
    embedding?: ReadonlyArray<number>;
  }> = [];
  const state = { failNext: opts.failNext ?? false };
  const port: SkillRegistryPort = {
    async upsertSkill(args) {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('upsert boom');
      }
      const entry: typeof calls[number] = {
        tenantId: args.tenantId,
        name: args.name,
        codeHash: args.codeHash,
      };
      if (args.embedding) entry.embedding = args.embedding;
      calls.push(entry);
      return { id: `sk-${calls.length}`, created: true };
    },
  };
  return { port, calls };
}

describe('runPromoteStage', () => {
  it('promotes a success cluster meeting both thresholds', async () => {
    const reg = makeRegistry();
    const out = await runPromoteStage({
      clusters: [makeCluster('c1')],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      logger: makeLogger(),
    });
    expect(out.skillsPromoted).toBe(1);
    expect(reg.calls).toHaveLength(1);
    expect(reg.calls[0]?.name).toBe('late-rent-reminder');
    expect(out.decisions[0]?.action).toBe('promote-skill');
  });

  it('no-ops when cluster has too few traces', async () => {
    const reg = makeRegistry();
    const out = await runPromoteStage({
      clusters: [makeCluster('c1', { traces: MIN_OCCURRENCES - 1 })],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      logger: makeLogger(),
    });
    expect(out.skillsPromoted).toBe(0);
    expect(out.decisions[0]?.action).toBe('no-op');
  });

  it('no-ops when score is below threshold', async () => {
    const reg = makeRegistry();
    const out = await runPromoteStage({
      clusters: [makeCluster('c1', { score: MIN_SUCCESS_SCORE - 0.1 })],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      logger: makeLogger(),
    });
    expect(out.skillsPromoted).toBe(0);
  });

  it('emits prompt-patch for failure clusters', async () => {
    const out = await runPromoteStage({
      clusters: [
        makeCluster('c1', { outcome: 'failure', score: -0.7 }),
      ],
      reflections: [
        { ...makeReflection('c1'), outcome: 'failure' },
      ],
      logger: makeLogger(),
    });
    expect(out.promptPatches).toBe(1);
    expect(out.decisions[0]?.action).toBe('prompt-patch');
  });

  it('no-ops mixed clusters', async () => {
    const out = await runPromoteStage({
      clusters: [makeCluster('c1', { outcome: 'mixed', score: 0 })],
      reflections: [{ ...makeReflection('c1'), outcome: 'mixed' }],
      logger: makeLogger(),
    });
    expect(out.skillsPromoted).toBe(0);
    expect(out.promptPatches).toBe(0);
    expect(out.decisions[0]?.action).toBe('no-op');
  });

  it('no-ops clusters without a reflection', async () => {
    const out = await runPromoteStage({
      clusters: [makeCluster('c1')],
      reflections: [],
      logger: makeLogger(),
    });
    expect(out.decisions[0]?.action).toBe('no-op');
    expect(out.decisions[0]?.reason).toMatch(/no reflection/);
  });
});

describe('runPromoteStage — embedder + registry behaviour', () => {
  it('passes embedding to the registry when embedder wired', async () => {
    const embedder: ConsolidationEmbedder = {
      async embed() {
        return new Array(1536).fill(0.1);
      },
    };
    const reg = makeRegistry();
    await runPromoteStage({
      clusters: [makeCluster('c1')],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      embedder,
      logger: makeLogger(),
    });
    expect(reg.calls[0]?.embedding?.length).toBe(1536);
  });

  it('promotes without embedding when the embedder throws', async () => {
    const embedder: ConsolidationEmbedder = {
      async embed() {
        throw new Error('embedder boom');
      },
    };
    const reg = makeRegistry();
    await runPromoteStage({
      clusters: [makeCluster('c1')],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      embedder,
      logger: makeLogger(),
    });
    expect(reg.calls).toHaveLength(1);
    expect(reg.calls[0]?.embedding).toBeUndefined();
  });

  it('logs but does not throw when upsert fails', async () => {
    const reg = makeRegistry({ failNext: true });
    const logger = makeLogger();
    const out = await runPromoteStage({
      clusters: [makeCluster('c1')],
      reflections: [makeReflection('c1')],
      skillRegistry: reg.port,
      logger,
    });
    expect(out.skillsPromoted).toBe(0);
    // Decision still gets emitted (best-effort surface).
    expect(out.decisions[0]?.action).toBe('promote-skill');
  });
});

describe('runPromoteStage — code_hash determinism', () => {
  it('produces the same code_hash for the same intent', async () => {
    const reg1 = makeRegistry();
    const reg2 = makeRegistry();
    await runPromoteStage({
      clusters: [makeCluster('c1', { intent: 'late-rent-reminder' })],
      reflections: [makeReflection('c1')],
      skillRegistry: reg1.port,
      logger: makeLogger(),
    });
    await runPromoteStage({
      clusters: [makeCluster('c2', { intent: 'late-rent-reminder' })],
      reflections: [{ ...makeReflection('c2'), text: 'different text' }],
      skillRegistry: reg2.port,
      logger: makeLogger(),
    });
    expect(reg1.calls[0]?.codeHash).toBe(reg2.calls[0]?.codeHash);
  });

  it('produces different hashes for different intents', async () => {
    const reg = makeRegistry();
    await runPromoteStage({
      clusters: [
        makeCluster('c1', { intent: 'late-rent-reminder' }),
        makeCluster('c2', { intent: 'lease-draft' }),
      ],
      reflections: [makeReflection('c1'), makeReflection('c2')],
      skillRegistry: reg.port,
      logger: makeLogger(),
    });
    expect(reg.calls[0]?.codeHash).not.toBe(reg.calls[1]?.codeHash);
  });
});
