/**
 * DRAFT_LETTER step handler.
 *
 * Calls into the report-engine to draft a letter from a template. The
 * letter id + checksum are returned and recorded in the step's audit row;
 * the actual letter is sent in a subsequent SEND_* step.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type ReportEnginePort } from './ports.js';

export function makeDraftLetterHandler(port: ReportEnginePort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const templateSlug = String(step.payload['templateSlug'] ?? '');
    const variables =
      (step.payload['variables'] as Record<string, unknown> | undefined) ?? {};

    if (!templateSlug) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'draft_letter: templateSlug is required',
        },
      };
    }

    try {
      const result = await port.draftLetter({
        tenantId: ctx.tenantId,
        templateSlug,
        variables,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: {
          letterId: result.letterId,
          checksum: result.checksum,
          templateSlug,
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'REPORT_ENGINE_ERROR',
          message: err instanceof Error ? err.message : 'draft_letter failed',
        },
      };
    }
  };
}

/** Static marker used by the index barrel — actual handler comes from the factory. */
export const draftLetterHandler = (): never => {
  throw new Error('draftLetterHandler must be built via makeDraftLetterHandler');
};
