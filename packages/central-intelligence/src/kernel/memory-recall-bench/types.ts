/**
 * Memory Recall Bench — types.
 *
 * Phase D fix-wave (A4) — closes the LITFIN parity gap "Memory recall
 * bench" (`08-eval-judge.md` Gap 8 / `00-STATUS-2026-05-18.md` §4).
 *
 * The bench is a deterministic, in-memory harness that drives the
 * kernel memory ports (`MemoryHierarchy` in `kernel/memory/types.ts`)
 * through a corpus of seeded facts + queries, and reports two metrics
 * per tier:
 *
 *   1. Exact-match  — share of queries whose expected fact id appears
 *                     in the top-k recalled set.
 *   2. Token-F1     — token-level F1 between expected answer text and
 *                     the recalled candidate's stringified value.
 *
 * The harness is intentionally separate from the kernel-eval scenarios
 * suite (`__tests__/eval/`) — that suite exercises end-to-end policy +
 * confidence + judge behaviour; this one isolates memory retrieval.
 *
 * Pure: no I/O, no network. Adapters bind in-memory fakes; production
 * baselines are produced offline.
 */

import type {
  MemoryHierarchy,
  SemanticFact,
  SemanticSource,
} from '../memory/types.js';

/** A single seeded fact + the query that should recall it. */
export interface RecallSample {
  /** Stable identifier for diffs / baselines. */
  readonly id: string;
  /** Which memory tier the sample targets. */
  readonly tier: 'episodic' | 'semantic' | 'procedural' | 'reflective';
  /** Tenant scope. `null` = cross-tenant fact (semantic tier only). */
  readonly tenantId: string | null;
  /** User scope. `null` = tenant-wide fact (semantic + reflective). */
  readonly userId: string | null;
  /**
   * Fact payload — shape depends on `tier`:
   *   - semantic:   `{ key, value, source?, confidence? }`
   *   - episodic:   `{ threadId, turnId, kind, summary, payload? }`
   *   - procedural: `{ patternName, toolSequence, triggerKeywords }`
   *   - reflective: `{ periodKind, periodStart, periodEnd, summary }`
   */
  readonly fact: Record<string, unknown>;
  /** Query that should retrieve the seeded fact. */
  readonly query: string;
  /**
   * Expected answer text — the bench tokenises this and the recalled
   * candidate's stringified value to compute token-F1.
   */
  readonly expectedAnswer: string;
}

export interface RecallMetric {
  readonly tier: RecallSample['tier'];
  readonly samples: number;
  readonly exactMatch: number;
  readonly tokenF1: number;
}

export interface RecallBenchReport {
  readonly totals: {
    readonly samples: number;
    readonly exactMatch: number;
    readonly tokenF1: number;
  };
  readonly perTier: ReadonlyArray<RecallMetric>;
  readonly perSample: ReadonlyArray<{
    readonly id: string;
    readonly tier: RecallSample['tier'];
    readonly matched: boolean;
    readonly tokenF1: number;
  }>;
}

export interface RecallBenchOptions {
  /** Top-k candidates considered when computing exact-match. Default 5. */
  readonly topK?: number;
  /**
   * Optional minimum token-F1 floor per tier. If supplied, the report
   * carries a `passed` boolean per tier. The bench itself never throws
   * — callers decide how to handle the result.
   */
  readonly floors?: Partial<Record<RecallSample['tier'], number>>;
}

export interface RecallBenchInput {
  readonly memory: MemoryHierarchy;
  readonly samples: ReadonlyArray<RecallSample>;
  readonly options?: RecallBenchOptions;
}

// Re-export the SemanticFact / SemanticSource so seeders can construct
// payloads without importing two paths.
export type { SemanticFact, SemanticSource };
