/**
 * SKILLS-loop WRITE-side wiring tests.
 *
 * Proves the consolidation worker's WRITE half of the Voyager skills
 * loop is live:
 *
 *   1. `createOrchestratorB4Deps(db)` now builds a `skillRegistry` port
 *      (null in degraded mode, non-null when a DB is present).
 *   2. That port is the REAL `skill_registry` writer — when the 8-stage
 *      orchestrator runs over recurring-success traces, stage 04-promote
 *      upserts a `skill_registry` row through it.
 *   3. End-to-end: feeding the orchestrator the B4-built `skillRegistry`
 *      promotes a recurring-success trace cluster into an upserted skill
 *      (the row reaches the Drizzle insert chain with the right shape).
 *
 * No real Postgres — a structural fake db captures the
 * `insert(skill_registry).values(...).onConflictDoUpdate(...).returning()`
 * chain so we can assert the upsert without a database.
 */

import { describe, it, expect, vi } from 'vitest';
import { createOrchestratorB4Deps } from '../index.js';
import { runConsolidationOrchestrator } from '../orchestrator.js';
import type {
  ImplicitSignalEntry,
  SkillRegistryPort,
  StageLogger,
  TraceEntry,
} from '../stages/types.js';
import type { IngestSources } from '../stages/01-ingest.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures — a recurring-success cluster (≥3 traces, all 'copy' signals
// → positive score) so stage 02 labels it a success cluster and stage 04
// crosses the MIN_OCCURRENCES (3) + MIN_SUCCESS_SCORE (0.5) thresholds.
// ─────────────────────────────────────────────────────────────────────

function logger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTraces(n: number, tenantId: string | null = 't-1'): TraceEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    traceId: `t${i}`,
    tenantId,
    userId: 'u-1',
    threadId: 'th',
    summary: 'draft late-rent reminder swahili',
    capturedAt: new Date(i * 1000).toISOString(),
  }));
}

function copySignals(
  traces: ReadonlyArray<TraceEntry>,
): ImplicitSignalEntry[] {
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
// Structural fake db — captures the skill_registry insert chain.
// ─────────────────────────────────────────────────────────────────────

interface CapturedUpsert {
  readonly values: Record<string, unknown>;
}

function makeCapturingDb(): {
  db: { execute: (q: unknown) => Promise<unknown> };
  upserts: CapturedUpsert[];
} {
  const upserts: CapturedUpsert[] = [];
  const insertChain = {
    values(v: Record<string, unknown>) {
      // Stash on the chain so `returning()` can echo the id back.
      (insertChain as { _v?: Record<string, unknown> })._v = v;
      return insertChain;
    },
    onConflictDoUpdate() {
      return insertChain;
    },
    returning() {
      const v = (insertChain as { _v?: Record<string, unknown> })._v ?? {};
      upserts.push({ values: v });
      return Promise.resolve([{ id: v.id }]);
    },
  };
  const db = {
    async execute() {
      return [];
    },
    insert() {
      return insertChain;
    },
  };
  return { db: db as unknown as { execute: (q: unknown) => Promise<unknown> }, upserts };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('SKILLS loop — WRITE side (createOrchestratorB4Deps.skillRegistry)', () => {
  it('returns a null skillRegistry in degraded mode (no db)', async () => {
    const deps = await createOrchestratorB4Deps(null);
    expect(deps.skillRegistry).toBeNull();
  });

  it('builds a non-null skillRegistry port when a db is present', async () => {
    const { db } = makeCapturingDb();
    const deps = await createOrchestratorB4Deps(db);
    expect(deps.skillRegistry).not.toBeNull();
    expect(typeof deps.skillRegistry?.upsertSkill).toBe('function');
  });

  it('promotes a recurring-success trace into an upserted skill (end-to-end)', async () => {
    const { db, upserts } = makeCapturingDb();
    const deps = await createOrchestratorB4Deps(db);
    expect(deps.skillRegistry).not.toBeNull();

    const traces = makeTraces(5, 't-1');
    const sources = makeSources(traces, copySignals(traces));

    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      skillRegistry: deps.skillRegistry!,
    });

    // The recurring-success cluster crossed the promote thresholds…
    expect(out.delta.skillsPromoted).toBeGreaterThanOrEqual(1);
    expect(out.errors).toEqual([]);

    // …and the upsert reached the Drizzle insert chain with a real
    // skill_registry row (tenant-scoped, named, code-hashed).
    expect(upserts.length).toBeGreaterThanOrEqual(1);
    const row = upserts[0]!.values;
    expect(row.tenantId).toBe('t-1');
    expect(typeof row.name).toBe('string');
    expect((row.name as string).length).toBeGreaterThan(0);
    expect(typeof row.codeHash).toBe('string');
    expect((row.codeHash as string).length).toBeGreaterThan(0);
    expect(row.status).toBe('active');
  });

  it('does NOT promote a too-small success cluster (below MIN_OCCURRENCES)', async () => {
    const { db, upserts } = makeCapturingDb();
    const deps = await createOrchestratorB4Deps(db);

    const traces = makeTraces(2, 't-1'); // 2 < 3 → no promotion
    const sources = makeSources(traces, copySignals(traces));

    const captured: Array<{ name: string }> = [];
    const spyPort: SkillRegistryPort = {
      async upsertSkill(args) {
        captured.push({ name: args.name });
        return deps.skillRegistry!.upsertSkill(args);
      },
    };

    const out = await runConsolidationOrchestrator({
      sources,
      logger: logger(),
      skillRegistry: spyPort,
    });

    expect(out.delta.skillsPromoted).toBe(0);
    expect(captured.length).toBe(0);
    expect(upserts.length).toBe(0);
  });
});
