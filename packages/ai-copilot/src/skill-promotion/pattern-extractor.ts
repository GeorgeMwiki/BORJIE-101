/**
 * Pattern extractor — pure, deterministic.
 *
 * Input:  procedural traces (each = ordered tool calls + outcome)
 * Output: candidate skills (each = recurring contiguous tool-name n-gram
 *         observed across ≥1 trace, aggregated success/failure counts)
 *
 * Strategy:
 *   For each trace, enumerate every contiguous n-gram with n in
 *   [MIN_NGRAM..MAX_NGRAM]. Key each n-gram by sha256(JSON(toolNames)) +
 *   tenant scope; aggregate occurrences + success/failure counts; keep
 *   the inputShape from the *first* trace contributing the pattern so the
 *   downstream promoter has a template to register.
 *
 * No I/O, no randomness, no time source (other than the trace timestamps
 * already on the inputs). Deterministic outputs for deterministic inputs.
 *
 * Why BFS? Because n-grams of different lengths are independent — we
 * enumerate width-first by n so the output ordering is stable: shorter
 * n-grams first, then by codeHash inside each n.
 */

import { createHash } from 'node:crypto';
import {
  type CandidateSkill,
  type ProceduralTrace,
  type ToolCall,
  MAX_NGRAM,
  MIN_NGRAM,
} from './types.js';

export interface PatternExtractorOptions {
  /** Override the n-gram floor (default: MIN_NGRAM = 2). Must be ≥ 2. */
  readonly minN?: number;
  /** Override the n-gram ceiling (default: MAX_NGRAM = 5). */
  readonly maxN?: number;
}

interface MutableAccumulator {
  readonly codeHash: string;
  readonly tenantId: string | null;
  readonly toolSequence: readonly ToolCall[];
  occurrences: number;
  successCount: number;
  failureCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Trace IDs that already contributed — prevents double-counting when
   *  the same n-gram appears twice in one trace. */
  contributingTraceIds: Set<string>;
}

function hashSequence(
  toolSequence: readonly ToolCall[],
  tenantId: string | null,
): string {
  const canonical = JSON.stringify({
    tenantId,
    tools: toolSequence.map((c) => c.toolName),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function compareIso(a: string, b: string, mode: 'min' | 'max'): string {
  return mode === 'min' ? (a < b ? a : b) : a > b ? a : b;
}

/**
 * Extract candidate skills from a batch of procedural traces.
 *
 * Returns CandidateSkills sorted by:
 *   1. ascending n-gram length (shorter patterns surface first)
 *   2. descending occurrence count (more common patterns first)
 *   3. ascending codeHash (deterministic tie-breaker)
 *
 * @param traces — input traces (may be empty; returns []).
 * @param options — n-gram window overrides.
 */
export function extractCandidates(
  traces: readonly ProceduralTrace[],
  options: PatternExtractorOptions = {},
): readonly CandidateSkill[] {
  const minN = Math.max(2, options.minN ?? MIN_NGRAM);
  const maxN = Math.max(minN, options.maxN ?? MAX_NGRAM);
  if (traces.length === 0) return [];

  const accumulators = new Map<string, MutableAccumulator>();

  // BFS by n: enumerate n=minN first, then minN+1, …, maxN.
  for (let n = minN; n <= maxN; n++) {
    for (const trace of traces) {
      const seq = trace.toolSequence;
      if (seq.length < n) continue;

      // Slide a contiguous window of size n.
      for (let i = 0; i + n <= seq.length; i++) {
        const window = seq.slice(i, i + n);
        const codeHash = hashSequence(window, trace.tenantId);
        const existing = accumulators.get(codeHash);

        if (!existing) {
          accumulators.set(codeHash, {
            codeHash,
            tenantId: trace.tenantId,
            toolSequence: window,
            occurrences: 1,
            successCount: trace.outcome === 'success' ? 1 : 0,
            failureCount: trace.outcome === 'failure' ? 1 : 0,
            firstSeenAt: trace.observedAt,
            lastSeenAt: trace.observedAt,
            contributingTraceIds: new Set([trace.traceId]),
          });
          continue;
        }

        // Same trace contributing twice (e.g. pattern repeats inside one
        // workflow) counts as ONE occurrence — Voyager treats a skill as
        // "this workflow did the pattern", not "the pattern appeared N
        // times in this workflow".
        if (existing.contributingTraceIds.has(trace.traceId)) {
          continue;
        }

        existing.occurrences += 1;
        if (trace.outcome === 'success') existing.successCount += 1;
        else existing.failureCount += 1;
        existing.firstSeenAt = compareIso(
          existing.firstSeenAt,
          trace.observedAt,
          'min',
        );
        existing.lastSeenAt = compareIso(
          existing.lastSeenAt,
          trace.observedAt,
          'max',
        );
        existing.contributingTraceIds.add(trace.traceId);
      }
    }
  }

  // Freeze into CandidateSkill[].
  const candidates: CandidateSkill[] = Array.from(accumulators.values()).map(
    (acc) => ({
      codeHash: acc.codeHash,
      tenantId: acc.tenantId,
      toolSequence: acc.toolSequence,
      occurrences: acc.occurrences,
      successCount: acc.successCount,
      failureCount: acc.failureCount,
      firstSeenAt: acc.firstSeenAt,
      lastSeenAt: acc.lastSeenAt,
    }),
  );

  // Stable sort: n asc, occurrences desc, codeHash asc.
  return candidates.sort((a, b) => {
    const dn = a.toolSequence.length - b.toolSequence.length;
    if (dn !== 0) return dn;
    const docc = b.occurrences - a.occurrences;
    if (docc !== 0) return docc;
    return a.codeHash < b.codeHash ? -1 : a.codeHash > b.codeHash ? 1 : 0;
  });
}
