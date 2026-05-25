/**
 * CALL_EXTERNAL_API step handler — generic outbound HTTP call. Used for
 * sovereign-tier integrations (KRA, TRA, KCC, …). The HIGH-risk prefix
 * `sovereign.*` must hit a literal policy rule.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type ExternalApiPort } from './ports.js';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function makeCallExternalApiHandler(
  port: ExternalApiPort,
): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const endpoint = String(step.payload['endpoint'] ?? '');
    const methodRaw = String(step.payload['method'] ?? 'POST');
    const bodyJson =
      (step.payload['bodyJson'] as Record<string, unknown> | undefined) ?? {};
    if (
      !endpoint ||
      !(ALLOWED_METHODS as ReadonlyArray<string>).includes(methodRaw)
    ) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'call_external_api: endpoint and valid method are required',
        },
      };
    }
    try {
      const result = await port.call({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        endpoint,
        method: methodRaw as (typeof ALLOWED_METHODS)[number],
        bodyJson,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: {
          statusCode: result.statusCode,
          bodySize: typeof result.body === 'string' ? result.body.length : 0,
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'EXTERNAL_API_ERROR',
          message:
            err instanceof Error ? err.message : 'call_external_api failed',
        },
      };
    }
  };
}

export const callExternalApiHandler = (): never => {
  throw new Error(
    'callExternalApiHandler must be built via makeCallExternalApiHandler',
  );
};
