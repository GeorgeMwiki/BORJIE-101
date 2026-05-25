/**
 * MUTATE_ENTITY step handler.
 *
 * Writes to a `core_entity` row via the injected EntityPort. The pre-
 * mutation state is read inside the saga BEFORE the handler runs so the
 * compensation can reverse-apply (the read happens in saga.ts so the
 * compensation row carries the priorState in its payload).
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type EntityPort } from './ports.js';

export function makeMutateEntityHandler(port: EntityPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const entityId = String(step.payload['entityId'] ?? '');
    const patch =
      (step.payload['patch'] as Record<string, unknown> | undefined) ?? null;
    const priorState =
      (step.payload['priorState'] as Record<string, unknown> | undefined) ??
      null;
    if (!entityId || !patch || !priorState) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'mutate_entity: entityId, patch, and priorState are required',
        },
      };
    }
    try {
      const result = await port.mutateEntity({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        entityId,
        patch,
        priorState,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { revisedAt: result.revisedAt.toISOString() },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'ENTITY_MUTATE_ERROR',
          message:
            err instanceof Error ? err.message : 'mutate_entity failed',
        },
      };
    }
  };
}

export const mutateEntityHandler = (): never => {
  throw new Error(
    'mutateEntityHandler must be built via makeMutateEntityHandler',
  );
};
