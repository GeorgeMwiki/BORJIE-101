/**
 * createDriveContextResolver — the `DriveContextResolver` port (Wave-C C3
 * WIN-3: graded homeostatic corrective).
 *
 * Maps an `MdCommitment` to its REAL standing-drive context
 * ({ driveId, breachSeverity }) by:
 *   1. mapping the commitment's `kind` / `competenceDomain` to a standing
 *      DriveId (the routing key), then
 *   2. reading the LIVE per-tenant `SituationalSnapshot` and running the kernel
 *      DEFAULT_DRIVES over it to recover that drive's TRUE breachSeverity
 *      (NOT the prior fabricated `c.sovereign ? 1 : 0.6`).
 *
 * This is the wire that threads the true standing-drive severity into the
 * reconcile engine so the corrective ladder is graded to the real danger and
 * the proposal carries the real driveId. PURE READ — it never mutates the
 * commitment, never acts, never reaches a money/licence path.
 *
 * HONEST-DEGRADE (hard rule): when there is no snapshot (a net-new / empty
 * estate, or a snapshot read fault) OR the commitment maps to no standing drive
 * OR the mapped drive is currently SATISFIED, `resolve` returns `null` — the
 * engine then keeps its prior fabricated-severity behaviour (no regression for
 * unbound items). A thrown resolver is also swallowed to `null` upstream.
 *
 * No `console.*` (Pino shim only). Immutable throughout.
 */

import { motivation as motivationKernel } from '@borjie/central-intelligence';
import type { situationalModel as situationalModelKernel } from '@borjie/central-intelligence';
import type { MdCommitment } from '@borjie/database/repositories';

import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type {
  DriveContext,
  DriveContextResolver,
} from './reconcile-engine.js';

type SituationalSnapshot = situationalModelKernel.SituationalSnapshot;
type DriveId = motivationKernel.DriveId;
type DriveThresholds = motivationKernel.DriveThresholds;

/** Reads the live per-tenant situational snapshot (the salience-arena store). */
export interface SituationalSnapshotReader {
  read(tenantId: string): Promise<SituationalSnapshot | null>;
}

export interface DriveContextResolverDeps {
  /**
   * The SAME durable situational-snapshot reader the salience arena + EstateMind
   * loop use (sovereign.ts buildSituationalSnapshotReader). When omitted / null
   * the resolver always honest-degrades to `null` (legacy behaviour).
   */
  readonly snapshotReader: SituationalSnapshotReader | null;
  /**
   * Per-tenant async threshold resolver (Wave-C C2). When provided, a breach is
   * judged against THIS estate's consolidated baseline; otherwise the kernel
   * DEFAULT_DRIVE_THRESHOLDS apply. Best-effort: a throw degrades to defaults.
   */
  readonly resolveThresholds?:
    | ((tenantId: string) => Promise<DriveThresholds>)
    | null;
  readonly logger?: PinoLikeLogger;
}

/**
 * Map a commitment to the standing DriveId it serves. Driven by the
 * commitment's domain `kind` (royalty.filing / licence.renewal / payroll.* /
 * cash.* …) with `competenceDomain` as the fallback signal — NEVER a
 * per-commitment hardcode. Returns `null` when the commitment is not bound to a
 * standing drive (an ordinary GTD follow-up) so it stays on the legacy ladder.
 */
export function driveIdForCommitment(c: MdCommitment): DriveId | null {
  const kind = (c.kind ?? '').toLowerCase();
  const domain = (c.competenceDomain ?? '').toLowerCase();
  const hay = `${kind} ${domain}`;

  // Order matters: the most specific concern wins. Each branch matches the
  // commitment's domain verb-stem against the standing drive it feeds.
  if (/royalt|receivabl|arrears|filing|tra\b/.test(hay)) return 'royalty-currency';
  if (/licen[cs]e|permit|renewal|compliance/.test(hay)) return 'licence-currency';
  if (/payroll|wage|salary|cash|treasury|runway|liquidit/.test(hay)) return 'cash-runway';
  if (/offtake|off-take|sales|marketplace|buyer|counterpart/.test(hay)) return 'offtake-coverage';
  if (/safety|incident|hazard|hse/.test(hay)) return 'safety';
  if (/equipment|asset|maintenance|fleet|machine/.test(hay)) return 'equipment-health';
  return null;
}

/**
 * Build the resolver. The composition root binds the live snapshot reader (the
 * same one the salience arena consumes) so the resolver recovers the true drive
 * severity from this estate's current situational state each tick.
 */
export function createDriveContextResolver(
  deps: DriveContextResolverDeps,
): DriveContextResolver {
  const logger = deps.logger ?? createPinoLikeLogger('drive-context-resolver');
  // The motivation engine is pure + stateless glue over the drive set; build it
  // once. The DEFAULT_DRIVES + DEFAULT_DRIVE_THRESHOLDS are the kernel canon.
  const baseEngine = motivationKernel.createMotivationEngine({});

  return {
    async resolve(c: MdCommitment): Promise<DriveContext | null> {
      const driveId = driveIdForCommitment(c);
      // Unbound commitment → legacy ladder (no regression).
      if (!driveId) return null;
      // No reader → cannot recover the TRUE severity → honest-degrade to legacy.
      if (!deps.snapshotReader) return null;

      const snapshot = await deps.snapshotReader.read(c.tenantId);
      // Empty / net-new estate → no live severity to thread → legacy behaviour.
      if (!snapshot) return null;

      // Judge against this estate's baseline when a resolver is bound; else the
      // kernel defaults. A throwing resolver degrades to defaults (never fails
      // the tick).
      let thresholds: DriveThresholds = {};
      if (deps.resolveThresholds) {
        try {
          thresholds = await deps.resolveThresholds(c.tenantId);
        } catch (err) {
          logger.warn(
            { tenantId: c.tenantId, driveId, err: errMsg(err) },
            'drive-context-resolver: threshold resolver failed — using kernel defaults',
          );
          thresholds = {};
        }
      }

      const engine =
        Object.keys(thresholds).length > 0
          ? motivationKernel.createMotivationEngine({ thresholds })
          : baseEngine;

      // Run the standing drives over the live snapshot and pull the matching
      // assessment. The engine is total — it never throws.
      const assessment = engine
        .assess(snapshot)
        .find((a) => a.driveId === driveId);

      // No assessment, or the drive is currently SATISFIED → there is no real
      // breach to grade the corrective against → honest-degrade to legacy (the
      // commitment still surfaces via the fabricated-severity path; we just do
      // not invent a breach the live estate does not show).
      if (!assessment || assessment.satisfied) return null;

      return Object.freeze({
        driveId,
        breachSeverity: clamp01(assessment.breachSeverity),
      });
    },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
