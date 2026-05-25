/**
 * SEND_EMAIL step handler.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type NotificationsPort } from './ports.js';

export function makeSendEmailHandler(port: NotificationsPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const recipientEmail = String(step.payload['recipientEmail'] ?? '');
    const subject = String(step.payload['subject'] ?? '');
    const bodyHtml = String(step.payload['bodyHtml'] ?? '');
    if (!recipientEmail || !subject || !bodyHtml) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'send_email: recipientEmail, subject, and bodyHtml are required',
        },
      };
    }
    try {
      const result = await port.sendEmail({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        recipientEmail,
        subject,
        bodyHtml,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { messageId: result.messageId },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'EMAIL_SEND_ERROR',
          message: err instanceof Error ? err.message : 'send_email failed',
        },
      };
    }
  };
}

export const sendEmailHandler = (): never => {
  throw new Error('sendEmailHandler must be built via makeSendEmailHandler');
};
