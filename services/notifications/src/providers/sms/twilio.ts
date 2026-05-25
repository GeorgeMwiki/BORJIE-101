/**
 * Twilio SMS Provider
 */

import twilio, { type Twilio } from 'twilio';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

const tenantClients = new Map<string, Twilio>();
const tenantNumbers = new Map<string, string>();

export class TwilioSmsProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'sms';
  readonly name = 'Twilio SMS';

  static registerConfig(tenantId: TenantId, config: TwilioSmsConfig): void {
    const client = twilio(config.accountSid, config.authToken);
    tenantClients.set(tenantId as string, client);
    tenantNumbers.set(tenantId as string, config.fromNumber);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantClients.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const client = tenantClients.get(params.tenantId as string);
    const fromNumber = tenantNumbers.get(params.tenantId as string);

    if (!client || !fromNumber) {
      return { success: false, error: 'Twilio SMS not configured for tenant' };
    }

    try {
      const message = await client.messages.create({
        body: params.body,
        from: fromNumber,
        to: params.to,
      });

      return { success: true, externalId: message.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const twilioSmsProvider = new TwilioSmsProvider();
