/**
 * EMIT_WEBHOOK step handler — fires through packages/agent-platform's
 * at-least-once webhook-delivery substrate.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type WebhookPort } from './ports.js';

export function makeEmitWebhookHandler(port: WebhookPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const eventType = String(step.payload['eventType'] ?? '');
    const payload =
      (step.payload['payload'] as Record<string, unknown> | undefined) ?? {};
    if (!eventType) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'emit_webhook: eventType is required',
        },
      };
    }
    try {
      const result = await port.emit({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        eventType,
        payload,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { deliveryId: result.deliveryId, eventType },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'WEBHOOK_EMIT_ERROR',
          message: err instanceof Error ? err.message : 'emit_webhook failed',
        },
      };
    }
  };
}

export const emitWebhookHandler = (): never => {
  throw new Error('emitWebhookHandler must be built via makeEmitWebhookHandler');
};
