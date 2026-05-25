/**
 * Shadow-mode runner — compares a candidate prompt version against the
 * currently-active version on the SAME input, collecting divergence
 * metrics that operators use to decide whether to promote the
 * candidate to `canary`.
 *
 * Central Command Phase D (D5 — Rollout safety). Sierra's Agent
 * Development Life Cycle pattern: a brand-new prompt runs in PARALLEL
 * with production for a measured window, with its output sunk to a
 * comparison ledger rather than the user. The user sees the active
 * version's response every time.
 *
 * Implementation:
 *   - `runOne(input)` invokes the active executor (the kernel's
 *     normal sensor call closure, abstracted as `executePrompt`) and
 *     ALSO invokes the candidate executor.
 *   - Both outputs are compared via a configurable comparator. The
 *     default comparator measures Levenshtein-distance-normalised
 *     similarity over the trimmed text body and flags major outcome
 *     differences (refusal vs. answer).
 *   - Each comparison emits a `ShadowComparison` to the configured
 *     sink. The sink is duck-typed; in production it persists to the
 *     consolidation runner's shadow-comparison table, in tests it is
 *     a memory array.
 *
 * Hard constraints honoured:
 *   - The candidate run NEVER reaches the user. Even if the candidate
 *     throws, the function returns the active output unchanged.
 *   - The candidate run is ALWAYS executed AFTER the active run so a
 *     slow candidate cannot back-pressure the live request.
 */

import { logger } from '../../logger.js';
export interface ShadowExecutorOutput {
  readonly text: string;
  readonly outcome: 'answer' | 'softened' | 'refusal';
  readonly costUsd: number;
  readonly latencyMs: number;
}

export type ShadowExecutor = (input: string) => Promise<ShadowExecutorOutput>;

export interface ShadowComparison {
  readonly capability: string;
  readonly activeVersion: string;
  readonly candidateVersion: string;
  readonly input: string;
  readonly activeOutput: ShadowExecutorOutput;
  readonly candidateOutput: ShadowExecutorOutput | null;
  readonly divergence: number; // 0..1; 0 = identical
  readonly outcomeChanged: boolean;
  readonly candidateFailed: boolean;
  readonly recordedAt: string;
}

export interface ShadowComparisonSink {
  record(comparison: ShadowComparison): Promise<void> | void;
}

export interface ShadowRunnerDeps {
  readonly capability: string;
  readonly activeVersion: string;
  readonly candidateVersion: string;
  readonly executeActive: ShadowExecutor;
  readonly executeCandidate: ShadowExecutor;
  readonly sink: ShadowComparisonSink;
  /**
   * Optional custom comparator. Default: normalized Levenshtein.
   * Returns 0..1 where 0 = identical, 1 = maximally different.
   */
  readonly comparator?: (a: string, b: string) => number;
  readonly clock?: () => Date;
}

export interface ShadowRunner {
  runOne(input: string): Promise<ShadowExecutorOutput>;
}

// ─────────────────────────────────────────────────────────────────────
// Comparator — normalized Levenshtein distance over trimmed text.
// Works on outputs up to a few thousand characters; long-form essays
// will pay an O(n*m) bill. The runner caps inputs to 8 KB before
// dispatching to the comparator to keep that bounded.
// ─────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row dynamic-programming table; O(min(n,m)) memory.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const prev = new Array<number>(shorter.length + 1);
  const curr = new Array<number>(shorter.length + 1);
  for (let i = 0; i <= shorter.length; i += 1) prev[i] = i;

  for (let j = 1; j <= longer.length; j += 1) {
    curr[0] = j;
    for (let i = 1; i <= shorter.length; i += 1) {
      const cost = shorter.charCodeAt(i - 1) === longer.charCodeAt(j - 1) ? 0 : 1;
      curr[i] = Math.min(
        (curr[i - 1] ?? 0) + 1, // insert
        (prev[i] ?? 0) + 1, // delete
        (prev[i - 1] ?? 0) + cost, // substitute
      );
    }
    for (let i = 0; i <= shorter.length; i += 1) prev[i] = curr[i]!;
  }
  return prev[shorter.length] ?? 0;
}

function defaultComparator(a: string, b: string): number {
  const aTrim = a.trim();
  const bTrim = b.trim();
  if (aTrim === bTrim) return 0;
  const dist = levenshtein(aTrim, bTrim);
  const denom = Math.max(aTrim.length, bTrim.length, 1);
  return Math.min(1, dist / denom);
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 8 * 1024;

function truncate(s: string): string {
  return s.length > MAX_INPUT_BYTES ? s.slice(0, MAX_INPUT_BYTES) : s;
}

export function createShadowRunner(deps: ShadowRunnerDeps): ShadowRunner {
  const compare = deps.comparator ?? defaultComparator;
  const clock = deps.clock ?? (() => new Date());

  return {
    async runOne(input) {
      // 1) Active path runs first and ALWAYS returns to the caller.
      const activeOutput = await deps.executeActive(input);

      // 2) Candidate path is best-effort; never affects the user.
      let candidateOutput: ShadowExecutorOutput | null = null;
      let candidateFailed = false;
      try {
        candidateOutput = await deps.executeCandidate(input);
      } catch (error) {
        candidateFailed = true;
        logger.error('shadow-runner: candidate execution failed', { error: error });
      }

      // 3) Comparison + sink. Sink errors are swallowed.
      const divergence = candidateOutput
        ? compare(
            truncate(activeOutput.text),
            truncate(candidateOutput.text),
          )
        : 1;
      const outcomeChanged = candidateOutput
        ? candidateOutput.outcome !== activeOutput.outcome
        : true;

      const comparison: ShadowComparison = {
        capability: deps.capability,
        activeVersion: deps.activeVersion,
        candidateVersion: deps.candidateVersion,
        input: truncate(input),
        activeOutput,
        candidateOutput,
        divergence,
        outcomeChanged,
        candidateFailed,
        recordedAt: clock().toISOString(),
      };

      try {
        await Promise.resolve(deps.sink.record(comparison));
      } catch (error) {
        logger.error('shadow-runner: sink record failed', { error: error });
      }

      return activeOutput;
    },
  };
}

export { defaultComparator };
