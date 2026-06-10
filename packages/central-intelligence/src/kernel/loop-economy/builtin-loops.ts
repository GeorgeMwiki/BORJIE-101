/**
 * builtin-loops — the PROOF-OF-CONCEPT that the `LoopSpec` primitive can
 * express a REAL, already-shipped loop.
 *
 * The estate's `forecast-surprise` DRIVE (active inference: attend first to
 * what most VIOLATED the forecast — `motivation/default-drives.ts`
 * `FORECAST_SURPRISE_DRIVE`) is today an implicit, hand-wired concern the
 * EstateMind slow loop evaluates every tick. Here we wrap that SAME drive as a
 * first-class, registrable `LoopSpec` to demonstrate the substrate.
 *
 * ADDITIVE + ZERO BEHAVIOUR CHANGE: this does NOT remove or alter the drive.
 * The drive remains the live implementation the motivation engine runs; this
 * loop READS it (`FORECAST_SURPRISE_DRIVE.evaluate`) to derive its predicate +
 * decided action. Nothing here is wired into the running brain — it is a
 * demonstration instance the registry/scheduler tests exercise. The loop-
 * former (a later wave) will SYNTHESISE specs of exactly this shape.
 *
 * GOVERNANCE: the loop only DECIDES (returns an action descriptor). Its
 * `actPort` is a string the host resolves and runs through the existing
 * governed proactive/proposal membrane — exactly as the drive's goal is gated
 * today. The loop never executes anything itself; it is at the safest tier
 * (T1 propose) — a surprise concern is a NUDGE, never an autonomous act.
 */

import type { SituationalSnapshot } from '../situational-model/types.js';
import { FORECAST_SURPRISE_DRIVE } from '../motivation/default-drives.js';
import { defineLoopSpec, type LoopContext, type LoopSpec } from './loop-spec.js';

/** The port the host folds the live situational snapshot into for this loop. */
export const SITUATIONAL_SNAPSHOT_PORT = 'situationalSnapshot';

/** The host act port this loop's decided action routes through (membrane-gated). */
export const FORECAST_SURPRISE_ACT_PORT = 'proactive.proposeConcern';

/** The host learn port that scores this loop's efficacy after the fact. */
export const FORECAST_SURPRISE_LEARN_PORT = 'reflexion.scoreLoopEfficacy';

/** The well-known id of the proof-of-concept builtin loop. */
export const FORECAST_SURPRISE_LOOP_ID = 'builtin:forecast-surprise';

/**
 * Read the situational snapshot the host folded into the loop context. Returns
 * `null` when absent or malformed — the loop's predicate then declines to fire
 * (no snapshot → no signal), honouring the drive pack's "absent data never
 * raises a concern" rule. Pure + total.
 */
function readSnapshot(ctx: LoopContext): SituationalSnapshot | null {
  const raw = ctx.ports[SITUATIONAL_SNAPSHOT_PORT];
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SituationalSnapshot>;
  if (typeof candidate.tenantId !== 'string') return null;
  if (!Array.isArray(candidate.entities)) return null;
  return raw as SituationalSnapshot;
}

/**
 * Build the proof-of-concept `forecast-surprise` builtin LoopSpec.
 *
 * It is a `tick` loop (the EstateMind slow loop cadence): each tick it folds
 * the situational snapshot, runs the SAME `FORECAST_SURPRISE_DRIVE.evaluate`,
 * and fires when the drive is UNSATISFIED (an outcome diverged sharply from
 * its forecast). `decide` returns a `proposeConcern` descriptor the host runs
 * through the governed membrane — it never acts inline.
 */
export function createForecastSurpriseLoop(args: {
  readonly createdAtMs: number;
  /** Tick cadence; defaults to 15 minutes (the slow-loop default cadence). */
  readonly everyMs?: number;
}): LoopSpec {
  const everyMs = args.everyMs ?? 15 * 60 * 1000;
  return defineLoopSpec({
    id: FORECAST_SURPRISE_LOOP_ID,
    title: 'Forecast-surprise concern (active inference)',
    trigger: { kind: 'tick', everyMs },
    organBindings: [SITUATIONAL_SNAPSHOT_PORT],
    actPort: FORECAST_SURPRISE_ACT_PORT,
    learnPort: FORECAST_SURPRISE_LEARN_PORT,
    autonomyTier: 'T1',
    origin: 'builtin',
    createdAtMs: args.createdAtMs,
    evaluate(ctx) {
      const snapshot = readSnapshot(ctx);
      if (snapshot === null) return false;
      // The drive owns the band logic; thresholds are unused by this drive but
      // required by the signature — pass an empty bag (built-in defaults).
      return FORECAST_SURPRISE_DRIVE.evaluate(snapshot, {}).satisfied === false;
    },
    decide(ctx) {
      const snapshot = readSnapshot(ctx);
      if (snapshot === null) return null;
      const assessment = FORECAST_SURPRISE_DRIVE.evaluate(snapshot, {});
      if (assessment.satisfied) return null;
      return {
        actPort: FORECAST_SURPRISE_ACT_PORT,
        autonomyTier: 'T1',
        summary: assessment.summary,
        args: {
          driveId: assessment.driveId,
          tenantId: snapshot.tenantId,
          breachSeverity: assessment.breachSeverity,
          urgency: assessment.urgency,
          evidenceCount: assessment.evidence.length,
        },
      };
    },
    // A builtin concern loop never self-retires — the host owns its lifecycle.
    retireCondition: () => false,
  });
}
