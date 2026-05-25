/**
 * VERIFY step handler — read-only check that a prior step succeeded.
 *
 * Payload shape:
 *   targetStepIndex:    the step to verify
 *   expectedStatus:     'SUCCEEDED' usually
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type VerifyPort } from './ports.js';

export function makeVerifyHandler(port: VerifyPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const targetStepIndexRaw = step.payload['targetStepIndex'];
    const expectedStatus = String(step.payload['expectedStatus'] ?? 'SUCCEEDED');
    if (typeof targetStepIndexRaw !== 'number') {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'verify: targetStepIndex must be a number',
        },
      };
    }
    try {
      const result = await port.verifyStep({
        tenantId: ctx.tenantId,
        planId: ctx.planId,
        targetStepIndex: targetStepIndexRaw,
        expectedStatus,
      });
      if (result.ok) {
        return {
          status: 'SUCCEEDED',
          resultPayload: { verified: true, targetStepIndex: targetStepIndexRaw },
        };
      }
      return {
        status: 'FAILED',
        error: {
          code: 'VERIFY_FAILED',
          message: result.reason ?? 'verify: target step did not match',
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'VERIFY_HANDLER_ERROR',
          message: err instanceof Error ? err.message : 'verify failed',
        },
      };
    }
  };
}

export const verifyHandler = (): never => {
  throw new Error('verifyHandler must be built via makeVerifyHandler');
};
