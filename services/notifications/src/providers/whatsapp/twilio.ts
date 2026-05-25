/**
 * Twilio WhatsApp Provider
 */

import twilio, { type Twilio } from 'twilio';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface TwilioWhatsAppConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
}

const tenantClients = new Map<string, Twilio>();
const tenantNumbers = new Map<string, string>();

export class TwilioWhatsAppProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'whatsapp';
  readonly name = 'Twilio WhatsApp';

  static registerConfig(tenantId: TenantId, config: TwilioWhatsAppConfig): void {
    const client = twilio(config.accountSid, config.authToken);
    tenantClients.set(tenantId as string, client);
    tenantNumbers.set(tenantId as string, config.whatsappNumber);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantClients.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const client = tenantClients.get(params.tenantId as string);
    const fromNumber = tenantNumbers.get(params.tenantId as string);

    if (!client || !fromNumber) {
      return { success: false, error: 'WhatsApp not configured for tenant' };
    }

    try {
      const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;
      const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

      const message = await client.messages.create({
        body: params.body,
        from,
        to,
      });

      return { success: true, externalId: message.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const twilioWhatsAppProvider = new TwilioWhatsAppProvider();
