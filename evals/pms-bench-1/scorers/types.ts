/**
 * Shared scorer types for PMS-bench-1.
 *
 * A scorer takes a task fixture + an observed sub-MD run, and returns a
 * score in [0, 1] plus a string rationale. The runner composes scorer
 * outputs into a weighted overall score using the per-task weights.
 */

export interface ExpectedAction {
  readonly tool: string;
  readonly [key: string]: unknown;
}

export interface TaskFixture {
  readonly id: string;
  readonly scenario: string;
  readonly title: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly expected_actions: ReadonlyArray<ExpectedAction>;
  readonly expected_escalation: boolean;
  readonly expected_escalation_reason?: string;
  readonly scorer_weights: Readonly<Record<string, number>>;
}

export interface ObservedAction {
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly tone?: string;
  readonly outcome?: 'ok' | 'failed';
}

export interface ObservedRun {
  /** Tools the sub-MD actually called, in order. */
  readonly actions: ReadonlyArray<ObservedAction>;
  /** Whether the sub-MD escalated to a human. */
  readonly escalated: boolean;
  /** Optional natural-language output (used by communication scorer). */
  readonly comm?: string;
  /** Total USD cents spent (model + tool fees). */
  readonly costUsdCents: number;
  /** Optional resolution-quality (0..1) for cost-efficiency normalisation. */
  readonly resolutionQuality?: number;
}

export interface ScoreResult {
  readonly scorer: string;
  readonly score: number;
  readonly rationale: string;
}

export type Scorer = (
  fixture: TaskFixture,
  run: ObservedRun,
) => ScoreResult | Promise<ScoreResult>;
