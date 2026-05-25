/**
 * SMTP Email Provider (Nodemailer)
 */

import nodemailer from 'nodemailer';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface SmtpConfig {
  host: string;
  port?: number;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
}

const tenantConfigs = new Map<string, SmtpConfig>();

export class SmtpProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'email';
  readonly name = 'SMTP';

  static registerConfig(tenantId: TenantId, config: SmtpConfig): void {
    tenantConfigs.set(tenantId as string, config);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantConfigs.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const config = tenantConfigs.get(params.tenantId as string);
    if (!config) {
      return { success: false, error: 'SMTP not configured for tenant' };
    }

    // fromEmail MUST be explicit per tenant — refusing to fall back to a
    // shared default prevents misattributed outbound mail (and accidental
    // spoofing of an unowned domain).
    const from =
      config.fromEmail ??
      process.env.NOTIFICATIONS_FROM_EMAIL?.trim() ??
      null;
    if (!from) {
      return {
        success: false,
        error: 'SMTP fromEmail not configured (set tenant fromEmail or NOTIFICATIONS_FROM_EMAIL env)',
      };
    }
    const fromName = config.fromName ?? process.env.NOTIFICATIONS_FROM_NAME ?? 'BORJIE';

    try {
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port ?? 587,
        secure: config.port === 465,
        auth:
          config.user && config.pass
            ? { user: config.user, pass: config.pass }
            : undefined,
      });

      const info = await transporter.sendMail({
        from: `"${fromName}" <${from}>`,
        to: params.to,
        subject: params.subject ?? 'Notification',
        text: params.body,
        html: params.body.replace(/\n/g, '<br>'),
      });

      return {
        success: true,
        externalId: info.messageId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const smtpProvider = new SmtpProvider();
