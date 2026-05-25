/**
 * EvalDriftEvent — the structured row that feeds the K-D Inspect harness.
 *
 * Every brainCall emits one of these. The Inspect harness samples + replays
 * a subset against the gold standard; alerts when the current-week
 * pass-rate drops > 5pp vs 4-week-rolling-mean.
 *
 * Hashes are FNV-1a 32-bit (no crypto dep). They identify identical
 * prompt/response pairs without storing raw content — keeps observability
 * compliant with tenant data-handling rules.
 */

import type { ModelTier, TaskKind, ProviderName } from '../types.js';

export interface EvalDriftEvent {
  readonly task: TaskKind;
  readonly model: ModelTier;
  readonly provider: ProviderName;
  readonly promptHash: string;
  readonly responseHash: string;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly fallbackDepth: number;
  readonly cascadeSteps: number;
  readonly wasHedged: boolean;
  readonly at: string; // ISO timestamp
}

/** FNV-1a 32-bit hash, no deps. Same algorithm used in dspy-compile/signature. */
export function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
