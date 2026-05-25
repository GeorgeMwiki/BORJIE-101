/**
 * FILE_GEPG step handler — files a bill / receipt with the Tanzania GePG
 * gateway. Compensation = retraction request.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type GepgPort } from './ports.js';

export function makeFileGepgHandler(port: GepgPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const billPayload =
      (step.payload['billPayload'] as Record<string, unknown> | undefined) ??
      null;
    if (!billPayload) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'file_gepg: billPayload is required',
        },
      };
    }
    try {
      const result = await port.fileReturn({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        billPayload,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: {
          fileId: result.fileId,
          gepgReceiptNumber: result.gepgReceiptNumber,
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'GEPG_FILE_ERROR',
          message: err instanceof Error ? err.message : 'file_gepg failed',
        },
      };
    }
  };
}

export const fileGepgHandler = (): never => {
  throw new Error('fileGepgHandler must be built via makeFileGepgHandler');
};
