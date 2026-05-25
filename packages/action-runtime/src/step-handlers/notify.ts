/**
 * NOTIFY step handler — in-app/push notification.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type NotificationsPort } from './ports.js';

export function makeNotifyHandler(port: NotificationsPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const channelRaw = String(step.payload['channel'] ?? 'email');
    const recipient = String(step.payload['recipient'] ?? '');
    const message = String(step.payload['message'] ?? '');
    if (!recipient || !message) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'notify: recipient and message are required',
        },
      };
    }
    try {
      let messageId: string;
      switch (channelRaw) {
        case 'sms':
          ({ messageId } = await port.sendSms({
            tenantId: ctx.tenantId,
            toolCallRef: ctx.toolCallRef ?? ctx.stepId,
            recipientPhone: recipient,
            body: message,
          }));
          break;
        case 'whatsapp':
          ({ messageId } = await port.sendWhatsapp({
            tenantId: ctx.tenantId,
            toolCallRef: ctx.toolCallRef ?? ctx.stepId,
            recipientPhone: recipient,
            templateSlug: 'generic_notify',
            variables: { message },
          }));
          break;
        case 'email':
        default:
          ({ messageId } = await port.sendEmail({
            tenantId: ctx.tenantId,
            toolCallRef: ctx.toolCallRef ?? ctx.stepId,
            recipientEmail: recipient,
            subject: 'Notification',
            bodyHtml: message,
          }));
          break;
      }
      return {
        status: 'SUCCEEDED',
        resultPayload: { messageId, channel: channelRaw },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'NOTIFY_ERROR',
          message: err instanceof Error ? err.message : 'notify failed',
        },
      };
    }
  };
}

export const notifyHandler = (): never => {
  throw new Error('notifyHandler must be built via makeNotifyHandler');
};
