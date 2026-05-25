/**
 * 8-stage orchestrator unit tests.
 *
 * Coverage:
 *   1. happy path runs every stage and emits a delta
 *   2. stage failure (cluster throws) → orchestrator continues with []
 *   3. promote stage flows skills + patches into the delta
 *   4. errors are surfaced in the result
 */

import { describe, it, expect, vi } from 'vitest';
import { runConsolidationOrchestrator } from '../../orchestrator.js';
import type {
  BrainDeltaPublisher,
  ImplicitSignalEntry,
  ReflectionCritic,
  SemanticDecayPort,
  SkillRegistryPort,
  StageLogger,
  TraceEntry,
} from '../../stages/types.js';
import type { IngestSources } from '../../stages/01-ingest.js';

function logger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeSources(traces: ReadonlyArray<TraceEntry>, signals: ReadonlyArray<ImplicitSignalEntry>): IngestSources {
  return {
    async fetchTraces() {
      return traces;
    },
    async fetchImplicitSignals() {
      return signals;
    },
    async fetchExplicitFeedback() {
      return [];
    },
  };
}

function manyTraces(n: number, opts: { summary?: string } = {}): TraceEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    traceId: `t${i}`,
    tenantId: 't-1',
    userId: 'u-1',
    threadId: 'th',
    summary: opts.summary ?? 'late rent reminder',
    capturedAt: new Date(i * 1000).toISOString(),
  }));
}

function copySignals(traces: ReadonlyArray<TraceEntry>): ImplicitSignalEntry[] {
  return traces.map((t, i) => ({
    id: `s${i}`,
    traceId: t.traceId,
    agentActionId: null,
    tenantId: t.tenantId ?? 't-1',
    userId: t.userId,
    surface: 'admin-portal',
    signalType: 'copy',
    strength: 1,
    emittedAt: new Date().toISOString(),
  }));
}

describe('runConsolidationOrchestrator', () => {
  it('happy path: every stage runs, delta emitted', async () => {
    const traces = manyTraces(5);
    const sources = makeSources(traces, copySignals(traces));
    const regCalls: Array<{ name: string }> = [];
    const skillRegistry: SkillRegistryPort = {
      async upsertSkill(args) {
        regCalls.push({ name: args.name });
        return { id: 'sk-1', created: true };
      },
    };
    const decay: SemanticDecayPort = {
      async decay() {
        return 10;
      },
    };
    const published: unknown[] = [];
    const publisher: BrainDeltaPublisher = {
      async publish(d) {
        published.push(d);
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      skillRegistry,
      semanticDecay: decay,
      publisher,
    });
    expect(out.delta.skillsPromoted).toBeGreaterThanOrEqual(1);
    expect(out.delta.factsDecayed).toBe(10);
    expect(published).toHaveLength(1);
    expect(regCalls.length).toBeGreaterThanOrEqual(1);
    expect(out.errors).toEqual([]);
  });

  it('stage failure is logged + orchestrator continues', async () => {
    const sources: IngestSources = {
      async fetchTraces() {
        throw new Error('traces source boom');
      },
      async fetchImplicitSignals() {
        return [];
      },
      async fetchExplicitFeedback() {
        return [];
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
    });
    // The ingest stage swallows the source failure internally and
    // returns an empty bundle, so the orchestrator continues past it.
    // No errors bubble up from the safeStage wrapper either.
    expect(out.delta.skillsPromoted).toBe(0);
  });

  it('failing critic does not crash the orchestrator', async () => {
    const traces = manyTraces(4);
    const sources = makeSources(traces, copySignals(traces));
    const critic: ReflectionCritic = {
      async reflect() {
        throw new Error('critic boom');
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      critic,
    });
    expect(out.delta.skillsPromoted).toBe(0); // no reflections → no promotion
    expect(out.clustersInspected).toBeGreaterThan(0);
  });

  it('flows promote → delta correctly', async () => {
    const traces = manyTraces(5);
    const sources = makeSources(traces, copySignals(traces));
    const skillRegistry: SkillRegistryPort = {
      async upsertSkill() {
        return { id: 'sk', created: true };
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      skillRegistry,
    });
    expect(out.delta.skillsPromoted).toBeGreaterThanOrEqual(1);
  });

  it('runs stage 09 weekly prompt-compile on Sundays only', async () => {
    const traces = manyTraces(3);
    const sources = makeSources(traces, copySignals(traces));
    const compile = vi.fn(async () => ({
      promptsCompiled: 4,
      promotedCount: 2,
    }));
    // Sunday
    await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      weekday: () => 0,
      weeklyPromptCompiler: compile,
    });
    expect(compile).toHaveBeenCalledOnce();

    // Wednesday — should NOT call compile
    compile.mockClear();
    await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      weekday: () => 3,
      weeklyPromptCompiler: compile,
    });
    expect(compile).not.toHaveBeenCalled();
  });

  it('forwards tracer through each stage', async () => {
    const stageCalls: string[] = [];
    const traces = manyTraces(2);
    const sources = makeSources(traces, copySignals(traces));
    await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      tracer: {
        async startTick(_tickId, fn) {
          return fn(async (stageId, stageFn) => {
            stageCalls.push(stageId);
            return stageFn();
          });
        },
      },
    });
    // All 8 normal stages should have been invoked through the tracer
    expect(stageCalls).toContain('01-ingest');
    expect(stageCalls).toContain('08-publish');
  });
});
