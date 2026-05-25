/**
 * COMPENSATE step handler.
 *
 * The COMPENSATE kind is special — it represents an EXPLICIT
 * compensation step authored inline in the plan (rather than the
 * automatic per-kind reversal driven by the compensation registry).
 * Inline COMPENSATE steps are rare; the registry handles the 90% case.
 *
 * Payload:
 *   handlerKey:        registry key to invoke
 *   targetStepIndex:   which prior step this compensates
 *   payloadOverride?:  extra payload for the handler
 */

import { type StepHandler, type StepHandlerResult } from './index.js';

export function makeCompensateHandler(): StepHandler {
  return async (step, _ctx): Promise<StepHandlerResult> => {
    const handlerKey = String(step.payload['handlerKey'] ?? '');
    const targetIdx = step.payload['targetStepIndex'];
    if (!handlerKey || typeof targetIdx !== 'number') {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'compensate: handlerKey and targetStepIndex are required',
        },
      };
    }
    // The actual reversal effect is driven by the compensation registry
    // when the saga rolls back. An inline COMPENSATE step is a
    // bookkeeping record only.
    return {
      status: 'SUCCEEDED',
      resultPayload: {
        handlerKey,
        targetStepIndex: targetIdx,
      },
    };
  };
}

export const compensateHandler = (): never => {
  throw new Error('compensateHandler must be built via makeCompensateHandler');
};
