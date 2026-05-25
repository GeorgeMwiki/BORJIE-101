/**
 * Process Reward Model substrate.
 *
 * L1 said "Phase 3 — needs training data". The TRUE near-term play is to
 * ship the substrate now so we accumulate data from day 1 of M-G; when a
 * PRM is later trained, we drop the checkpoint in (env `PRM_MODEL_PATH`) and
 * everything starts scoring without an API or schema change.
 *
 *   1. **Data collection**  → emit `prm_training_sample` events to J1 every
 *                              multi-step action that lands with an outcome.
 *   2. **Runtime scoring**  → `scoreStepWithPRM` returns `unscored` when no
 *                              model is loaded; returns `scored` when one is.
 *                              The PRM module on disk is loaded lazily via a
 *                              caller-supplied `prmLoader` function. The
 *                              shape of the model is fully abstract — what
 *                              matters is the input/output contract.
 *   3. **Eval harness**     → load a candidate checkpoint, run against
 *                              `prm_eval_set` (50 fixtures), report
 *                              calibration curve + accuracy.
 */

import type { JsonValue, Outcome, StepScore } from '../shared/types.js';

export interface PrmStep {
  readonly index: number;
  readonly description: string;
  /** Optional structured context (tool args, observed state diff, etc.). */
  readonly context?: JsonValue;
}

export interface PrmTrainingSample {
  readonly version: '1.0';
  readonly conversationId: string;
  readonly taskClass: string;
  readonly steps: ReadonlyArray<PrmStep>;
  readonly outcome: Outcome;
  /** Aggregated trajectory reward from K-D Reflexion / action receipts. */
  readonly rewardSignal: number;
  readonly emittedAt: string;
  /** Free-form metadata — e.g. `{ jurisdiction: 'TZ-DSM' }`. */
  readonly metadata?: { readonly [k: string]: JsonValue };
}

/** Caller-supplied emitter — typically the J1 entity bus client. */
export type J1Emitter = (sample: PrmTrainingSample) => Promise<void>;

export interface EmitPrmTrainingSampleInput {
  readonly conversationId: string;
  readonly taskClass: string;
  readonly steps: ReadonlyArray<PrmStep>;
  readonly outcome: Outcome;
  readonly rewardSignal: number;
  readonly metadata?: { readonly [k: string]: JsonValue };
}

/**
 * The opaque model handle. Could be an ONNX session, a remote endpoint,
 * a local llama.cpp wrapper — we don't care. Only the contract matters.
 */
export interface PrmModel {
  readonly modelId: string;
  /** Score a single step in [0, 1]. */
  readonly score: (
    step: PrmStep,
    contextSteps: ReadonlyArray<PrmStep>,
  ) => Promise<number>;
}

/**
 * Returns null when no model is configured (e.g. PRM_MODEL_PATH unset).
 * Implementations should be idempotent — load once, return the same handle.
 */
export type PrmLoader = () => Promise<PrmModel | null>;

export interface ScoreStepWithPrmInput {
  readonly step: PrmStep;
  readonly contextSteps?: ReadonlyArray<PrmStep>;
  readonly loader: PrmLoader;
  /**
   * Soft threshold below which the runner should emit a low-score warning.
   * Default 0.4. Set to 0 to disable warnings.
   */
  readonly warnBelow?: number;
  /** Optional callback invoked on low scores — typically logs to J1. */
  readonly onLowScore?: (score: number, step: PrmStep) => void;
}

export interface PrmEvalFixture {
  readonly id: string;
  readonly step: PrmStep;
  readonly contextSteps: ReadonlyArray<PrmStep>;
  /** Human label in [0, 1]. */
  readonly humanLabel: number;
}

export interface PrmEvalResult {
  readonly modelId: string;
  readonly fixtures: number;
  readonly meanAbsoluteError: number;
  readonly accuracyAt0p5: number;
  /** 10-bucket calibration curve: bucket i has bin centre i/10 + 0.05. */
  readonly calibration: ReadonlyArray<CalibrationBucket>;
}

export interface CalibrationBucket {
  readonly binCentre: number;
  readonly count: number;
  readonly meanHumanLabel: number;
}

export type { Outcome, StepScore };
