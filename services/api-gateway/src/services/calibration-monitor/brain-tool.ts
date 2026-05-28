/**
 * Brain tool: `mining.calibration.score`.
 *
 * Wave CLOSED-LOOP. Lets the owner ask Mr. Mwikila "did your last N
 * recommendations work?" and lets the brain itself self-check before
 * making a confidence claim. The tool reads outcome_predictions +
 * outcome_reconciliations through the calibration-tracker port.
 *
 * Returns the matched / divergent / undetermined / expired breakdown
 * plus accuracy + mean drift + a per-confidence-band curve. Read-only
 * (isWrite: false on the persona descriptor side - the tool is added
 * to the WRITE-tools wrapper exclusion list automatically because we
 * never set `isWrite: true` here).
 */

import type {
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@borjie/ai-copilot';
import type { CalibrationTracker } from './tracker';

export interface CalibrationScoreToolDeps {
  readonly tracker: CalibrationTracker;
}

export interface CalibrationScoreTool extends ToolHandler {
  readonly name: 'mining.calibration.score';
}

const PARAMETER_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  properties: {
    sinceDays: {
      type: 'number',
      description:
        'Look-back window in days (defaults to 30). The score is computed over predictions whose created_at falls inside this window.',
    },
    actorKind: {
      type: 'string',
      enum: ['brain', 'owner', 'agent', 'external'],
      description: 'Optional filter for who proposed/took the action.',
    },
    actionKindPrefix: {
      type: 'string',
      description:
        'Optional prefix filter on action_kind (e.g. "mining.licence.").',
    },
  },
});

export function buildCalibrationScoreTool(
  deps: CalibrationScoreToolDeps,
): CalibrationScoreTool {
  return {
    name: 'mining.calibration.score',
    description:
      'Mr. Mwikila self-check: return the proportion of recent predictions that matched the observed outcome. Use when the owner asks "did your recommendations work" or before quoting a confidence number, so the reply reflects measured accuracy not vibes.',
    parameters: PARAMETER_SCHEMA,
    async execute(
      params: Record<string, unknown>,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      const sinceDaysRaw = params.sinceDays;
      const sinceDays =
        typeof sinceDaysRaw === 'number' && Number.isFinite(sinceDaysRaw)
          ? Math.max(1, Math.min(365, Math.round(sinceDaysRaw)))
          : 30;
      const actorKindRaw = params.actorKind;
      const actorKindFilter =
        actorKindRaw === 'brain' ||
        actorKindRaw === 'owner' ||
        actorKindRaw === 'agent' ||
        actorKindRaw === 'external'
          ? (actorKindRaw as 'brain' | 'owner' | 'agent' | 'external')
          : undefined;
      const actionKindPrefixRaw = params.actionKindPrefix;
      const actionKindPrefix =
        typeof actionKindPrefixRaw === 'string' &&
        actionKindPrefixRaw.length > 0
          ? actionKindPrefixRaw
          : undefined;

      try {
        const score = await deps.tracker.getCalibrationScore({
          tenantId: context.tenant.tenantId,
          sinceDays,
          ...(actorKindFilter !== undefined && { actorKindFilter }),
          ...(actionKindPrefix !== undefined && { actionKindPrefix }),
        });
        return Object.freeze({
          ok: true,
          data: score,
          evidenceSummary: `${score.matchedCount} matched / ${score.divergentCount} divergent in last ${score.sinceDays}d (accuracy ${score.accuracy})`,
        });
      } catch (err) {
        return Object.freeze({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'calibration tracker failed',
        });
      }
    },
  };
}
