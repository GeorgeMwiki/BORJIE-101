/**
 * SendGrid Email Provider
 */

import sgMail from '@sendgrid/mail';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface SendGridConfig {
  apiKey: string;
  fromEmail?: string;
  fromName?: string;
}

const tenantConfigs = new Map<string, SendGridConfig>();

export class SendGridProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'email';
  readonly name = 'SendGrid';

  static registerConfig(tenantId: TenantId, config: SendGridConfig): void {
    tenantConfigs.set(tenantId as string, config);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantConfigs.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const config = tenantConfigs.get(params.tenantId as string);
    if (!config) {
      return { success: false, error: 'SendGrid not configured for tenant' };
    }

    const from =
      config.fromEmail ??
      process.env.NOTIFICATIONS_FROM_EMAIL?.trim() ??
      null;
    if (!from) {
      return {
        success: false,
        error: 'SendGrid fromEmail not configured (set tenant fromEmail or NOTIFICATIONS_FROM_EMAIL env)',
      };
    }
    const fromName = config.fromName ?? process.env.NOTIFICATIONS_FROM_NAME ?? 'BORJIE';

    try {
      sgMail.setApiKey(config.apiKey);
      const [response] = await sgMail.send({
        to: params.to,
        from: { email: from, name: fromName },
        subject: params.subject ?? 'Notification',
        text: params.body,
        html: params.body.replace(/\n/g, '<br>'),
      });

      const externalId = response.headers['x-message-id'] as string | undefined;
      return {
        success: true,
        ...(externalId !== undefined ? { externalId } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const sendGridProvider = new SendGridProvider();
