/**
 * SEND_SMS step handler.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type NotificationsPort } from './ports.js';

export function makeSendSmsHandler(port: NotificationsPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const recipientPhone = String(step.payload['recipientPhone'] ?? '');
    const body = String(step.payload['body'] ?? '');
    if (!recipientPhone || !body) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'send_sms: recipientPhone and body are required',
        },
      };
    }
    try {
      const result = await port.sendSms({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        recipientPhone,
        body,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { messageId: result.messageId },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'SMS_SEND_ERROR',
          message: err instanceof Error ? err.message : 'send_sms failed',
        },
      };
    }
  };
}

export const sendSmsHandler = (): never => {
  throw new Error('sendSmsHandler must be built via makeSendSmsHandler');
};
