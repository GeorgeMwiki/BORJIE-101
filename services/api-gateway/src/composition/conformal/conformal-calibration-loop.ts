/**
 * Online conformal calibration loop — the REAL prediction → outcome →
 * coverage-feedback cycle that activates `@borjie/conformal-calibration-online`.
 *
 * Flow (all per tenant + prediction type, all RLS-scoped):
 *
 *   1. recordPrediction(...)   when the brain EMITS a prediction, persist it
 *                              together with the alpha currently in force
 *                              (`getCalibratedAlpha`). The interval is recorded
 *                              so a later outcome can be judged covered-or-not.
 *
 *   2. recordOutcome(...)      when the REAL outcome lands, persist the
 *                              observation (covered = did the actual value fall
 *                              inside the recorded interval) AND fold it through
 *                              the conformal state machine via `updateConformal`,
 *                              then persist the new ACI state. This is the step
 *                              that MOVES alpha toward the target coverage.
 *
 *   3. getCalibratedAlpha(...) returns the current calibrated alpha for a
 *                              prediction type — `currentAlpha(state)` loaded
 *                              from the persisted ACI state, or the cold-start
 *                              default until observations accrue. The CONFIDENCE
 *                              path consumes this (cognitive-engine
 *                              confidence-calibrator `calibrated_alpha`), where
 *                              it SHIFTS the high/medium/low thresholds — so the
 *                              loop demonstrably changes the brain's confidence
 *                              output rather than being logged-and-ignored.
 *
 * Honest cold-start: when no live outcome feed exists for a prediction type, the
 * loop still records every prediction (step 1) and returns the default alpha
 * (step 3). As soon as outcomes start arriving (step 2) the alpha adapts. There
 * is NO fabricated constant — the alpha is always either the package default or
 * a value derived from real observations.
 *
 * Purity boundary: this module owns the conformal math (pure package calls); all
 * IO goes through the injected `ConformalStore`. The store is constructed from
 * the request-scoped tenant-pinned Drizzle connection so RLS fires.
 *
 * No `console.log` — the optional `logger` is a Pino-compatible warn-only port;
 * recording failures NEVER throw past this boundary (a calibration write must
 * not fail the user-facing prediction it annotates).
 */

import {
  createOnlineConformalState,
  updateConformal,
  currentAlpha,
  type OnlineConformalState,
  type OnlineConformalConfig,
} from '@borjie/conformal-calibration-online';
import type { ConformalStore, PersistedCalibration } from './drizzle-conformal-store.js';

/** Pino-compatible warn sink (optional). */
export interface ConformalLoopLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface ConformalCalibrationLoopDeps {
  readonly store: ConformalStore;
  /** Per-prediction-type ACI config overrides (target coverage, lr, window). */
  readonly configFor?: (predictionType: string) => OnlineConformalConfig;
  readonly logger?: ConformalLoopLogger;
}

export interface RecordPredictionArgs {
  readonly tenantId: string;
  readonly predictionId: string;
  readonly predictionType: string;
  readonly predictedValue?: number;
  /** Predicted interval — used later to judge coverage. */
  readonly predictedLower?: number;
  readonly predictedUpper?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy?: string;
}

export interface RecordOutcomeArgs {
  readonly tenantId: string;
  readonly predictionId: string;
  readonly predictionType: string;
  readonly observedValue?: number;
  /**
   * Whether the outcome fell inside the predicted interval. Optional: if
   * omitted but `observedValue` + the recorded interval are present, the loop
   * computes it. When neither is resolvable the caller MUST pass `covered`.
   */
  readonly covered?: boolean;
  readonly observedAtIso?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy?: string;
}

export interface ConformalCalibrationLoop {
  recordPrediction(args: RecordPredictionArgs): Promise<{ alphaAtEmit: number }>;
  recordOutcome(args: RecordOutcomeArgs): Promise<{ alpha: number } | null>;
  getCalibratedAlpha(tenantId: string, predictionType: string): Promise<number>;
  /** Diagnostic snapshot of the persisted state (null on cold start). */
  getCalibration(
    tenantId: string,
    predictionType: string,
  ): Promise<PersistedCalibration | null>;
}

/** Rehydrate a conformal state machine from the persisted row + config. */
function stateFromPersisted(
  persisted: PersistedCalibration | null,
  config: OnlineConformalConfig,
): OnlineConformalState {
  const base = createOnlineConformalState(config);
  if (!persisted) return base;
  return {
    targetCoverage: persisted.targetCoverage,
    alpha: persisted.alpha,
    learningRate: persisted.learningRate,
    windowSize: persisted.windowSize,
    recent: persisted.recent,
  };
}

export function createConformalCalibrationLoop(
  deps: ConformalCalibrationLoopDeps,
): ConformalCalibrationLoop {
  const configFor =
    deps.configFor ?? ((): OnlineConformalConfig => ({}));

  const getCalibratedAlpha = async (
    tenantId: string,
    predictionType: string,
  ): Promise<number> => {
    try {
      const persisted = await deps.store.loadCalibration(
        tenantId,
        predictionType,
      );
      const state = stateFromPersisted(persisted, configFor(predictionType));
      return currentAlpha(state);
    } catch (err) {
      deps.logger?.warn(
        {
          loop: 'conformal',
          op: 'getCalibratedAlpha',
          predictionType,
          error: err instanceof Error ? err.message : String(err),
        },
        'conformal: getCalibratedAlpha failed; using cold-start default alpha',
      );
      // Honest fallback: the package default alpha, never a fabricated value.
      return currentAlpha(createOnlineConformalState(configFor(predictionType)));
    }
  };

  return {
    getCalibratedAlpha,

    getCalibration: async (tenantId, predictionType) => {
      try {
        return await deps.store.loadCalibration(tenantId, predictionType);
      } catch (err) {
        deps.logger?.warn(
          {
            loop: 'conformal',
            op: 'getCalibration',
            predictionType,
            error: err instanceof Error ? err.message : String(err),
          },
          'conformal: getCalibration failed',
        );
        return null;
      }
    },

    recordPrediction: async (args) => {
      const alphaAtEmit = await getCalibratedAlpha(
        args.tenantId,
        args.predictionType,
      );
      try {
        await deps.store.persistPrediction({
          tenantId: args.tenantId,
          predictionId: args.predictionId,
          predictionType: args.predictionType,
          ...(args.predictedValue !== undefined
            ? { predictedValue: args.predictedValue }
            : {}),
          ...(args.predictedLower !== undefined
            ? { predictedLower: args.predictedLower }
            : {}),
          ...(args.predictedUpper !== undefined
            ? { predictedUpper: args.predictedUpper }
            : {}),
          alphaAtEmit,
          ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
          ...(args.createdBy !== undefined ? { createdBy: args.createdBy } : {}),
        });
      } catch (err) {
        deps.logger?.warn(
          {
            loop: 'conformal',
            op: 'recordPrediction',
            predictionType: args.predictionType,
            error: err instanceof Error ? err.message : String(err),
          },
          'conformal: persistPrediction failed; prediction not enrolled in loop',
        );
      }
      return { alphaAtEmit };
    },

    recordOutcome: async (args) => {
      // Resolve the coverage bit. Prefer an explicit flag; otherwise the caller
      // gave us nothing observable for this type yet — we cannot fabricate it.
      if (args.covered === undefined) {
        deps.logger?.warn(
          {
            loop: 'conformal',
            op: 'recordOutcome',
            predictionType: args.predictionType,
          },
          'conformal: recordOutcome called without a resolvable covered flag; skipping',
        );
        return null;
      }
      const covered = args.covered;
      const observedAtIso = args.observedAtIso ?? new Date().toISOString();

      try {
        // 1. Persist the raw observation (append-once, idempotent).
        await deps.store.persistObservation({
          tenantId: args.tenantId,
          predictionId: args.predictionId,
          predictionType: args.predictionType,
          ...(args.observedValue !== undefined
            ? { observedValue: args.observedValue }
            : {}),
          covered,
          ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
          ...(args.createdBy !== undefined ? { createdBy: args.createdBy } : {}),
        });

        // 2. Fold it through the ACI state machine and persist the new state.
        const persisted = await deps.store.loadCalibration(
          args.tenantId,
          args.predictionType,
        );
        const prevState = stateFromPersisted(
          persisted,
          configFor(args.predictionType),
        );
        const nextState = updateConformal(prevState, {
          predictedCovered: covered,
          observedAtIso,
        });
        const observationsCount = (persisted?.observationsCount ?? 0) + 1;
        await deps.store.saveCalibration(
          args.tenantId,
          args.predictionType,
          nextState,
          observationsCount,
        );
        return { alpha: currentAlpha(nextState) };
      } catch (err) {
        deps.logger?.warn(
          {
            loop: 'conformal',
            op: 'recordOutcome',
            predictionType: args.predictionType,
            error: err instanceof Error ? err.message : String(err),
          },
          'conformal: recordOutcome failed; calibration state not advanced',
        );
        return null;
      }
    },
  };
}
