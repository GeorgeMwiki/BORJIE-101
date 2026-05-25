/**
 * Africa's Talking SMS Provider
 */

import AfricasTalking from 'africastalking';
import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
}

const tenantConfigs = new Map<string, AfricasTalkingConfig>();

export class AfricasTalkingSmsProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'sms';
  readonly name = "Africa's Talking";

  static registerConfig(tenantId: TenantId, config: AfricasTalkingConfig): void {
    tenantConfigs.set(tenantId as string, config);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantConfigs.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const config = tenantConfigs.get(params.tenantId as string);
    if (!config) {
      return { success: false, error: 'Africa\'s Talking SMS not configured for tenant' };
    }

    try {
      const at = AfricasTalking({
        apiKey: config.apiKey,
        username: config.username,
      }).SMS;

      const result = await at.send({
        to: [params.to],
        message: params.body,
      });

      const message = result.SMSMessageData?.Recipients?.[0];
      if (message?.status === 'Success') {
        return {
          success: true,
          externalId: message.messageId,
        };
      }

      return {
        success: false,
        error: message?.status ?? result.SMSMessageData?.Message ?? 'Unknown error',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const africasTalkingSmsProvider = new AfricasTalkingSmsProvider();
