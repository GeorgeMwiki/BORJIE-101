/**
 * Chat-turn conformal confidence bridge.
 *
 * Glue between the live chat orchestrator and the online-ACI loop. Given the
 * request-scoped (unpinned) Drizzle handle + the tenant, it:
 *
 *   1. opens a SHORT per-tenant transaction (`withTenantContext`) so RLS FORCE
 *      sees the tenant GUC — the chat route mounts `databaseMiddlewareNoPin`, so
 *      the connection is NOT pre-pinned; the conformal_* reads MUST bind the GUC
 *      themselves (CLAUDE.md RLS hard rule),
 *   2. loads the calibrated alpha for the chat prediction type via the loop's
 *      `getCalibratedAlpha`,
 *   3. applies the proven bounded alpha→tier shift to the emitted confidence
 *      float (`applyConformalConfidence`), returning the adjusted confidence the
 *      orchestrator ships on the `message_chunk`.
 *
 * Honest cold-start / failure: any DB / loop failure (or no persisted state yet)
 * degrades to the raw emitted confidence snapped to the UNSHIFTED tiers — i.e.
 * the conformal-off path. Never throws past this boundary: a calibration read
 * must NOT fail the user-facing answer it annotates. No `console.log` (the
 * optional warn sink is Pino-compatible).
 *
 * The prediction type for a chat turn is `CHAT_CONFIDENCE_PREDICTION_TYPE` — the
 * loop learns chat-turn coverage SEPARATELY from the closed-loop telemetry
 * prediction types (keyed by `action_kind`), so one tenant's alpha per signal
 * family stays isolated.
 */

import { withTenantContext } from '@borjie/database';
import { createDrizzleConformalStore } from './drizzle-conformal-store.js';
import { createConformalCalibrationLoop } from './conformal-calibration-loop.js';
import {
  applyConformalConfidence,
  type ConformalConfidenceResult,
} from './conformal-confidence-gate.js';

/**
 * The conformal prediction-type slug under which CHAT-TURN confidence coverage
 * is calibrated. Distinct from the closed-loop telemetry types so chat alpha and
 * action-outcome alpha never cross-contaminate.
 */
export const CHAT_CONFIDENCE_PREDICTION_TYPE = 'chat_turn_confidence';

/** Pino-compatible warn sink (optional). */
export interface ChatConformalLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface ApplyChatConformalArgs {
  /** Request-scoped (unpinned) Drizzle handle from the chat route. */
  readonly db: unknown;
  readonly tenantId: string;
  /** The confidence float the brain emitted for this turn. */
  readonly rawConfidence: number;
  readonly logger?: ChatConformalLogger;
}

/**
 * Fetch the tenant's live calibrated alpha and re-grade the emitted chat
 * confidence against the alpha-shifted tiers. Returns the full result (adjusted
 * confidence + tier + thresholds + alpha) so callers may also surface the tier;
 * the orchestrator only needs `.confidence`.
 */
export async function applyChatConformalConfidence(
  args: ApplyChatConformalArgs,
): Promise<ConformalConfidenceResult> {
  // Honest fallback if there is no usable db handle: snap the raw float to the
  // unshifted tiers (alpha = undefined ⇒ conformal-off).
  if (!args.db) {
    return applyConformalConfidence(args.rawConfidence, undefined);
  }

  let alpha: number | undefined;
  try {
    alpha = await withTenantContext(
      args.db as Parameters<typeof withTenantContext>[0],
      args.tenantId,
      async (tx) => {
        const loop = createConformalCalibrationLoop({
          store: createDrizzleConformalStore(tx),
          ...(args.logger ? { logger: args.logger } : {}),
        });
        return loop.getCalibratedAlpha(
          args.tenantId,
          CHAT_CONFIDENCE_PREDICTION_TYPE,
        );
      },
    );
  } catch (err) {
    args.logger?.warn(
      {
        bridge: 'chat-conformal',
        op: 'getCalibratedAlpha',
        error: err instanceof Error ? err.message : String(err),
      },
      'chat-conformal: alpha fetch failed; using unshifted confidence tiers',
    );
    alpha = undefined;
  }

  return applyConformalConfidence(args.rawConfidence, alpha);
}
