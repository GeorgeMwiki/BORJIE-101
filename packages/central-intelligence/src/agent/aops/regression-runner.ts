/**
 * Regression runner — replays a RegressionSet's historical transcripts
 * against a candidate AOPSpec version and computes a pass-rate.
 *
 * Pass rule for one transcript (deterministic, no LLM-as-judge here —
 * keep the substrate pure; rubric scoring is layered above):
 *
 *   transcript passes ⇔
 *     trace.ok = true
 *     AND (expectedAnswerSubstring ⊂ trace.finalOutput | empty)
 *     AND every expectedSignal token appears in
 *         (trace.finalOutput | tool-name list | tool-input keys)
 *
 * Pass-rate threshold is applied by the *caller* (canary-bridge) — the
 * regression runner reports raw numbers so multiple thresholds can
 * coexist (e.g. tenant: 0.95, platform: 0.90).
 */

import type { AOPRunner } from './aop-runner.js';
import type { AOPTrace } from './aop-runner.js';
import type { AOPSpec, RegressionSet, RegressionTranscript } from './aop-spec.js';

// ─────────────────────────────────────────────────────────────────────
// Report shape
// ─────────────────────────────────────────────────────────────────────

export interface TranscriptResult {
  readonly transcriptId: string;
  readonly passed: boolean;
  readonly reason: string;
  readonly trace: AOPTrace;
}

export interface RegressionReport {
  readonly aopId: string;
  readonly aopVersion: string;
  readonly regressionSetId: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly passRate: number;
  readonly results: ReadonlyArray<TranscriptResult>;
  readonly startedAt: string;
  readonly completedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────

function buildHaystack(trace: AOPTrace): string {
  const toolNames = trace.toolCalls.map((c) => c.toolName).join(' ');
  const toolInputs = trace.toolCalls
    .map((c) => Object.keys(c.input).join(' '))
    .join(' ');
  return `${trace.finalOutput}\n${toolNames}\n${toolInputs}`;
}

export function scoreTranscript(
  transcript: RegressionTranscript,
  trace: AOPTrace,
): { readonly passed: boolean; readonly reason: string } {
  if (!trace.ok) {
    return { passed: false, reason: `trace failed: ${trace.errorMessage ?? 'unknown error'}` };
  }
  if (
    transcript.expectedAnswerSubstring !== undefined &&
    !trace.finalOutput.includes(transcript.expectedAnswerSubstring)
  ) {
    return {
      passed: false,
      reason: `final output missing expected substring '${transcript.expectedAnswerSubstring}'`,
    };
  }
  const haystack = buildHaystack(trace);
  for (const signal of transcript.expectedSignals) {
    if (!haystack.includes(signal)) {
      return { passed: false, reason: `missing expected signal '${signal}'` };
    }
  }
  return { passed: true, reason: 'all checks passed' };
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

export interface RegressionRunnerDeps {
  readonly runner: AOPRunner;
  readonly clock?: () => Date;
}

export interface RegressionRunner {
  /**
   * Replay every transcript in `set` against `spec`, return a frozen
   * report. Concurrency is sequential — regression suites must be
   * deterministic for canary gating, and parallelism complicates that
   * (tool-stub state, clock interleaving). Future: optional bounded
   * concurrency knob.
   */
  run(spec: AOPSpec, set: RegressionSet): Promise<RegressionReport>;
}

export function createRegressionRunner(deps: RegressionRunnerDeps): RegressionRunner {
  const now = deps.clock ?? (() => new Date());

  return {
    async run(spec, set) {
      const startedAt = now().toISOString();
      const results: TranscriptResult[] = [];
      for (const transcript of set.transcripts) {
        const trace = await deps.runner.run(spec, {
          userMessage: transcript.userMessage,
          metadata: { regressionTranscriptId: transcript.id },
        });
        const { passed, reason } = scoreTranscript(transcript, trace);
        results.push({ transcriptId: transcript.id, passed, reason, trace });
      }
      const completedAt = now().toISOString();
      const total = results.length;
      const passed = results.filter((r) => r.passed).length;
      const failed = total - passed;
      const passRate = total === 0 ? 1 : passed / total;
      return Object.freeze({
        aopId: spec.id,
        aopVersion: spec.version,
        regressionSetId: set.id,
        total,
        passed,
        failed,
        passRate,
        results: Object.freeze(results),
        startedAt,
        completedAt,
      });
    },
  };
}
