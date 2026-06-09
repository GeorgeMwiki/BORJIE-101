/**
 * Anomaly-detection brain tool — Wave-3 closure of the DARK
 * `@borjie/anomaly-detection` organ (MASTER_WIRING_CLOSURE_PLAN.md).
 *
 * Before this wiring the package barrel exported real statistical
 * detectors (z-score / MAD / isolation-forest / Page-Hinkley ensembles)
 * and was a declared dep of `@borjie/market-intelligence`, but the only
 * references anywhere were comment-only `LATER(wire)` lines in
 * `disruption-detector.ts` — no runtime import, no kernel binding. This
 * module makes the organ REACHABLE as a single persona-aware brain tool:
 *
 *   - `mwikila.anomaly.detect`
 *        Runs ONE of the five mining-domain detectors over a caller-
 *        supplied numeric baseline + current reading and returns the real
 *        `AnomalyVerdict` (score / threshold / anomalous flag + the
 *        detector's own evidence map). The five signals mirror
 *        `@borjie/anomaly-detection/domain/mining-anomalies`:
 *          fuel-consumption · weight-bridge · worker-check-in ·
 *          royalty-filing · equipment-vibration.
 *        LOW stakes, READ-only, sensor/propose-only — NEVER actuates.
 *
 * HARD-RULE compliance (closure plan):
 *   - Env flag: `BORJIE_ANOMALY_DETECTION_ENABLED` (default OFF — this
 *     ADDS compute; opt-in after a staging canary).
 *   - Budget bound: `BORJIE_ANOMALY_BUDGET_MS` (default 1500ms) via the
 *     shared `runOrganWithBudget` guard. A slow detector can NEVER stall
 *     a brain turn — it resolves a typed `budget-exceeded` skip instead.
 *   - Fail-safe: any organ error resolves to a typed `organ-error` skip;
 *     the tool NEVER throws into the turn.
 *   - Evidence-required (CLAUDE.md): every `anomalous:true` verdict
 *     carries the detector id + the concrete evidence map (sample counts,
 *     per-detector sub-scores) as the evidence chain. A clean / skipped
 *     result reports an empty chain and an honest status — never a
 *     fabricated anomaly.
 *   - Sensor-only: no sovereign rail, no money/licence actuation.
 *
 * @module services/api-gateway/src/composition/brain-tools/anomaly-detection-tools
 */

import { z } from 'zod';
import {
  equipmentVibrationOutlier,
  fuelConsumptionSpike,
  royaltyFilingIrregularity,
  weightBridgeDeviation,
  workerCheckInMiss,
  type AnomalyVerdict,
} from '@borjie/anomaly-detection';

import type { PersonaToolDescriptor } from './types.js';
import {
  organFlagDefaultOff,
  resolveBudgetMs,
  runOrganWithBudget,
} from './organ-budget-guard.js';

export const ANOMALY_DETECTION_FLAG = 'BORJIE_ANOMALY_DETECTION_ENABLED';
export const ANOMALY_BUDGET_MS_KEY = 'BORJIE_ANOMALY_BUDGET_MS';
const DEFAULT_ANOMALY_BUDGET_MS = 1_500;

const OWNER_ADMIN_MANAGER: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T2_admin_strategist', 'T3_module_manager'];

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const SignalKind = z.enum([
  'fuel-consumption',
  'weight-bridge',
  'worker-check-in',
  'royalty-filing',
  'equipment-vibration',
]);

const AnomalyDetectInput = z.object({
  /** Which mining-domain detector to run. */
  signal: SignalKind,
  /** The entity under test (asset / truck / worker / quarter / equipment). */
  targetId: z.string().min(1).max(120),
  /**
   * Historic baseline series the detector trains against. Required for
   * every signal except `equipment-vibration`, which uses the feature
   * matrix instead. Capped to keep the compute bounded.
   */
  baseline: z.array(z.number().finite()).max(10_000).optional(),
  /** Most-recent scalar reading (fuel L/h, royalty rate, etc.). */
  current: z.number().finite().optional(),
  /** weight-bridge only: recorded pit + buyer weights. */
  pitWeight: z.number().finite().positive().optional(),
  buyerWeight: z.number().finite().nonnegative().optional(),
  /** worker-check-in only: per-day minutes-late deltas. */
  deltas: z.array(z.number().finite()).max(10_000).optional(),
  /** equipment-vibration only: historic feature matrix + current row. */
  historicFeatures: z
    .array(z.array(z.number().finite()).max(64))
    .max(2_000)
    .optional(),
  currentFeatures: z.array(z.number().finite()).max(64).optional(),
  /** Optional deterministic seed for the iForest (replay/audit). */
  seed: z.number().int().optional(),
});

const VerdictSchema = z.object({
  detector: z.string(),
  target: z.string(),
  value: z.number(),
  score: z.number(),
  threshold: z.number(),
  anomalous: z.boolean(),
  evidence: z.record(z.unknown()),
  detectedAtIso: z.string(),
});

const AnomalyDetectOutput = z.object({
  status: z.enum(['ok', 'skipped', 'invalid_input']),
  /** The real detector verdict; null when skipped / invalid. */
  verdict: VerdictSchema.nullable(),
  /**
   * Evidence chain (CLAUDE.md). For an `anomalous:true` verdict this is
   * the detector id + the concrete evidence keys; empty otherwise.
   */
  evidenceIds: z.array(z.string()),
  note: z.string().optional(),
});

type AnomalyDetectInputT = z.infer<typeof AnomalyDetectInput>;

// ─────────────────────────────────────────────────────────────────────
// Detector dispatch — pure, throws on missing-arg (caught by the guard).
// ─────────────────────────────────────────────────────────────────────

function runDetector(
  tenantId: string,
  input: AnomalyDetectInputT,
): AnomalyVerdict {
  switch (input.signal) {
    case 'fuel-consumption': {
      if (input.baseline === undefined || input.current === undefined) {
        throw new Error('fuel-consumption requires baseline + current');
      }
      return fuelConsumptionSpike({
        tenantId,
        assetId: input.targetId,
        baseline: input.baseline,
        current: input.current,
      });
    }
    case 'weight-bridge': {
      if (
        input.baseline === undefined ||
        input.pitWeight === undefined ||
        input.buyerWeight === undefined
      ) {
        throw new Error('weight-bridge requires baseline + pitWeight + buyerWeight');
      }
      return weightBridgeDeviation({
        tenantId,
        truckId: input.targetId,
        historicRatios: input.baseline,
        pitWeight: input.pitWeight,
        buyerWeight: input.buyerWeight,
      });
    }
    case 'worker-check-in': {
      if (input.deltas === undefined || input.deltas.length === 0) {
        throw new Error('worker-check-in requires a non-empty deltas series');
      }
      return workerCheckInMiss({
        tenantId,
        workerId: input.targetId,
        deltas: input.deltas,
      });
    }
    case 'royalty-filing': {
      if (input.baseline === undefined || input.current === undefined) {
        throw new Error('royalty-filing requires baseline (historic rates) + current');
      }
      return royaltyFilingIrregularity({
        tenantId,
        quarter: input.targetId,
        historicRates: input.baseline,
        currentRate: input.current,
      });
    }
    case 'equipment-vibration': {
      if (
        input.historicFeatures === undefined ||
        input.historicFeatures.length === 0 ||
        input.currentFeatures === undefined
      ) {
        throw new Error('equipment-vibration requires historicFeatures + currentFeatures');
      }
      return equipmentVibrationOutlier({
        tenantId,
        equipmentId: input.targetId,
        historicFeatures: input.historicFeatures,
        currentFeatures: input.currentFeatures,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      });
    }
    default: {
      const never: never = input.signal;
      throw new Error(`unknown signal: ${String(never)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// mwikila.anomaly.detect
// ─────────────────────────────────────────────────────────────────────

export const anomalyDetectTool: PersonaToolDescriptor<
  typeof AnomalyDetectInput,
  typeof AnomalyDetectOutput
> = {
  id: 'mwikila.anomaly.detect',
  name: 'Anomaly detection — operational signal',
  description:
    'Run a statistically-grounded anomaly detector over ONE operational ' +
    'mining signal: fuel-consumption (MAD+z ensemble), weight-bridge (z on ' +
    'pit/buyer ratio), worker-check-in (Page-Hinkley drift), royalty-filing ' +
    '(MAD on effective rate), or equipment-vibration (isolation forest on ' +
    'accelerometer features). Use when the owner asks "is this reading ' +
    'abnormal", "is asset X burning more fuel than usual", "did the buyer ' +
    'underweigh truck Y", "is this royalty rate out of line", or any ' +
    'equivalent is-this-an-outlier question, AND a baseline series is ' +
    'available. Returns the real detector verdict (score / threshold / ' +
    'anomalous flag) plus its evidence map — never an estimate. READ-only, ' +
    'LOW stakes, propose-only (it flags; it never actuates). Backed by the ' +
    '@borjie/anomaly-detection reference detectors.',
  personaSlugs: OWNER_ADMIN_MANAGER,
  inputSchema: AnomalyDetectInput,
  outputSchema: AnomalyDetectOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const env = process.env;
    const outcome = await runOrganWithBudget(
      {
        enabled: organFlagDefaultOff(env, ANOMALY_DETECTION_FLAG),
        budgetMs: resolveBudgetMs(
          env,
          ANOMALY_BUDGET_MS_KEY,
          DEFAULT_ANOMALY_BUDGET_MS,
        ),
      },
      () => runDetector(ctx.tenantId, input),
    );

    if (!outcome.ok) {
      // Honest degrade: typed skip with an empty evidence chain. We do not
      // distinguish a missing-arg throw from a true organ fault to the
      // caller beyond the note — both are "no verdict produced".
      const note =
        outcome.reason === 'disabled'
          ? 'anomaly-detection organ disabled (set BORJIE_ANOMALY_DETECTION_ENABLED=1)'
          : outcome.reason === 'budget-exceeded'
            ? `anomaly compute exceeded budget (${outcome.elapsedMs}ms)`
            : (outcome.detail ?? 'anomaly compute failed');
      return {
        status: outcome.reason === 'organ-error' ? 'invalid_input' : 'skipped',
        verdict: null,
        evidenceIds: [],
        note,
      };
    }

    const v = outcome.value;
    // Evidence chain — only a real anomaly carries a chain; a clean read is
    // honestly reported with an empty chain (never a fabricated anomaly).
    const evidenceIds = v.anomalous
      ? [
          `anomaly-detector:${v.detector}`,
          `anomaly-target:${v.target}`,
          ...Object.keys(v.evidence).map((k) => `anomaly-evidence:${k}`),
        ]
      : [];

    return {
      status: 'ok' as const,
      verdict: {
        detector: v.detector,
        target: v.target,
        value: v.value,
        score: v.score,
        threshold: v.threshold,
        anomalous: v.anomalous,
        evidence: v.evidence as Record<string, unknown>,
        detectedAtIso: v.detectedAtIso,
      },
      evidenceIds,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalogue export
// ─────────────────────────────────────────────────────────────────────

export const ANOMALY_DETECTION_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  anomalyDetectTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
