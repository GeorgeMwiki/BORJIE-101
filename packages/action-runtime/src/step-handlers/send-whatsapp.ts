/**
 * SEND_WHATSAPP step handler.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type NotificationsPort } from './ports.js';

export function makeSendWhatsappHandler(
  port: NotificationsPort,
): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const recipientPhone = String(step.payload['recipientPhone'] ?? '');
    const templateSlug = String(step.payload['templateSlug'] ?? '');
    const variables =
      (step.payload['variables'] as Record<string, unknown> | undefined) ?? {};
    if (!recipientPhone || !templateSlug) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'send_whatsapp: recipientPhone and templateSlug are required',
        },
      };
    }
    try {
      const result = await port.sendWhatsapp({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        recipientPhone,
        templateSlug,
        variables,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { messageId: result.messageId },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'WHATSAPP_SEND_ERROR',
          message: err instanceof Error ? err.message : 'send_whatsapp failed',
        },
      };
    }
  };
}

export const sendWhatsappHandler = (): never => {
  throw new Error(
    'sendWhatsappHandler must be built via makeSendWhatsappHandler',
  );
};
