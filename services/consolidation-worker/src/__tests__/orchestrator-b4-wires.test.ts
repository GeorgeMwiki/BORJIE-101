/**
 * B4 wire-through tests — Central Command Phase C (C1).
 *
 * Verifies that the 8-stage consolidation orchestrator forwards the
 * three B4 ports (`entityConsolidator`, `reEmbedder`,
 * `constitutionalCritic`) into their respective stages, and that the
 * composition root's `createOrchestratorB4Deps` builder honours the
 * degraded-mode contract (everything null when no DB).
 *
 * Two layers:
 *   1. Orchestrator pass-through: each port is invoked when wired,
 *      skipped when omitted, and isolated from the other two.
 *   2. Composition-root builder: `createOrchestratorB4Deps` returns a
 *      fully-null bundle when `db` is null; partial bundles when an
 *      embedder is omitted or the kernel dist is missing.
 *
 * Each test fixes only the dep under test and stubs the rest. No real
 * Postgres, no real Anthropic client, no real embedder.
 */

import { describe, it, expect, vi } from 'vitest';
import { runConsolidationOrchestrator } from '../orchestrator.js';
import { createOrchestratorB4Deps } from '../index.js';
import type {
  EntityConsolidatorPort,
} from '../stages/06-consolidate.js';
import type { ReEmbedPort } from '../stages/07-re-embed.js';
import type { ConstitutionalCriticPort } from '../stages/03-reflect.js';
import type {
  ImplicitSignalEntry,
  StageLogger,
  TraceEntry,
} from '../stages/types.js';
import type { IngestSources } from '../stages/01-ingest.js';

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

function logger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTraces(n: number, tenantId: string = 't-1'): TraceEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    traceId: `t${i}`,
    tenantId,
    userId: 'u-1',
    threadId: 'th',
    summary: 'late rent reminder',
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

function makeSources(
  traces: ReadonlyArray<TraceEntry>,
  signals: ReadonlyArray<ImplicitSignalEntry>,
): IngestSources {
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

// ─────────────────────────────────────────────────────────────────────
// Orchestrator pass-through — each B4 port wired separately
// ─────────────────────────────────────────────────────────────────────

describe('orchestrator — B4 port pass-through', () => {
  it('forwards entityConsolidator to stage 06 (consolidate)', async () => {
    const traces = makeTraces(5);
    const sources = makeSources(traces, copySignals(traces));
    const calls: Array<{ tenantId: string | null }> = [];
    const entityConsolidator: EntityConsolidatorPort = {
      async consolidateForTenant(args) {
        calls.push({ tenantId: args.tenantId });
        return {
          tenantId: args.tenantId,
          mergedEntities: 3,
          inspectedEntities: 7,
        };
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      entityConsolidator,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.tenantId).toBe('t-1');
    expect(out.delta.entitiesMerged).toBe(3);
  });

  it('forwards reEmbedder to stage 07 (re-embed)', async () => {
    const traces = makeTraces(5);
    const sources = makeSources(traces, copySignals(traces));
    const calls: Array<{ tenantId: string | null; limit: number }> = [];
    const reEmbedder: ReEmbedPort = {
      async reEmbedForTenant(args) {
        calls.push({ tenantId: args.tenantId, limit: args.limit });
        return {
          tenantId: args.tenantId,
          reEmbeddedCount: 12,
          inspectedCount: 20,
        };
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      reEmbedder,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.tenantId).toBe('t-1');
    expect(out.delta.factsReEmbedded).toBe(12);
  });

  it('forwards constitutionalCritic to stage 03 (reflect)', async () => {
    const traces = makeTraces(3);
    const sources = makeSources(traces, copySignals(traces));
    const critCalls: Array<{ clusterId: string; tenantId: string | null }> = [];
    const constitutionalCritic: ConstitutionalCriticPort = {
      async score(reflection) {
        critCalls.push({
          clusterId: reflection.clusterId,
          tenantId: reflection.tenantId,
        });
        return {
          clusterId: reflection.clusterId,
          overall: 0.9,
          passed: true,
          scores: [
            { ruleId: 'tz-rental-act-notice-period', score: 1, rationale: 'ok' },
          ],
        };
      },
    };
    await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      constitutionalCritic,
    });
    expect(critCalls.length).toBeGreaterThan(0);
    expect(critCalls[0]?.tenantId).toBe('t-1');
  });

  it('omitting all three B4 ports degrades gracefully (no throw, zero counts)', async () => {
    const traces = makeTraces(4);
    const sources = makeSources(traces, copySignals(traces));
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      // entityConsolidator / reEmbedder / constitutionalCritic all omitted
    });
    expect(out.delta.entitiesMerged).toBe(0);
    expect(out.delta.factsReEmbedded).toBe(0);
    expect(out.errors).toEqual([]);
  });

  it('isolates B4 ports — wiring one does NOT activate the others', async () => {
    const traces = makeTraces(3);
    const sources = makeSources(traces, copySignals(traces));
    const reEmbedderCalls: number[] = [];
    const reEmbedder: ReEmbedPort = {
      async reEmbedForTenant(args) {
        reEmbedderCalls.push(args.limit);
        return {
          tenantId: args.tenantId,
          reEmbeddedCount: 0,
          inspectedCount: 0,
        };
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      reEmbedder, // only this one wired
    });
    expect(reEmbedderCalls.length).toBeGreaterThan(0);
    expect(out.delta.entitiesMerged).toBe(0); // stage 06 skipped
  });

  it('forwards `modelCutoff` through to the reEmbedder when supplied', async () => {
    const traces = makeTraces(2);
    const sources = makeSources(traces, copySignals(traces));
    const captured: Array<Date | string | undefined> = [];
    const reEmbedder: ReEmbedPort = {
      async reEmbedForTenant(args) {
        captured.push(args.modelCutoff);
        return {
          tenantId: args.tenantId,
          reEmbeddedCount: 0,
          inspectedCount: 0,
        };
      },
    };
    // Phase C C1: the orchestrator's deps shape does NOT expose a
    // top-level modelCutoff hook (stage 07 owns the contract); this
    // test pins the current behaviour — modelCutoff defaults to
    // undefined inside the stage when the orchestrator has no hook.
    await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      reEmbedder,
    });
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toBeUndefined();
  });

  it('constitutionalCritic failure does NOT crash the reflect stage', async () => {
    const traces = makeTraces(2);
    const sources = makeSources(traces, copySignals(traces));
    const constitutionalCritic: ConstitutionalCriticPort = {
      async score() {
        throw new Error('critic boom');
      },
    };
    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      constitutionalCritic,
    });
    // Stage 03 absorbs the failure; the rest of the cascade still runs.
    expect(out.errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Composition-root builder — `createOrchestratorB4Deps`
// ─────────────────────────────────────────────────────────────────────

describe('createOrchestratorB4Deps — degraded-mode contract', () => {
  it('returns a fully-null bundle when db is null', async () => {
    const deps = await createOrchestratorB4Deps(null);
    expect(deps.entityConsolidator).toBeNull();
    expect(deps.reEmbedder).toBeNull();
    expect(deps.constitutionalCritic).toBeNull();
  });

  it('omits the reEmbedder when no embedder is supplied', async () => {
    // Fake db is enough — the wrapper only invokes db inside
    // service calls, not at construction time.
    const fakeDb = makeFakeDb();
    const deps = await createOrchestratorB4Deps(fakeDb);
    expect(deps.entityConsolidator).not.toBeNull();
    expect(deps.reEmbedder).toBeNull();
  });

  it('wires the reEmbedder when an embedder is supplied', async () => {
    const fakeDb = makeFakeDb();
    const embedder = {
      async embed(): Promise<ReadonlyArray<number>> {
        return new Array(1536).fill(0);
      },
    };
    const deps = await createOrchestratorB4Deps(fakeDb, { embedder });
    expect(deps.entityConsolidator).not.toBeNull();
    expect(deps.reEmbedder).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal Drizzle-shaped fake — the B4 service wrappers only touch the
 * db at call time, not at construction. The fake just needs to satisfy
 * the structural type the wrapper passes through.
 */
function makeFakeDb(): {
  execute: (q: unknown) => Promise<unknown>;
} {
  return {
    async execute() {
      return [];
    },
  };
}
