/**
 * AWS SES Email Provider
 */

import type { TenantId } from '../../types/index.js';
import type { INotificationProvider, SendParams } from '../provider.interface.js';
import type { NotificationChannel, SendResult } from '../../types/index.js';

export interface SesConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fromEmail?: string;
  fromName?: string;
}

const tenantConfigs = new Map<string, SesConfig>();
const clientCache = new Map<string, Awaited<ReturnType<typeof createSesClient>>>();

async function createSesClient(config: SesConfig) {
  const { SESClient } = await import('@aws-sdk/client-ses');
  return new SESClient({
    region: config.region,
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
  });
}

async function getSesClient(config: SesConfig) {
  const cacheKey = `${config.region}:${config.accessKeyId ?? 'default'}`;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = await createSesClient(config);
    clientCache.set(cacheKey, client);
  }
  return client;
}

export class SesProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'email';
  readonly name = 'AWS SES';

  static registerConfig(tenantId: TenantId, config: SesConfig): void {
    tenantConfigs.set(tenantId as string, config);
  }

  isConfigured(tenantId: TenantId): boolean {
    return tenantConfigs.has(tenantId as string);
  }

  async send(params: SendParams): Promise<SendResult> {
    const config = tenantConfigs.get(params.tenantId as string);
    if (!config) {
      return { success: false, error: 'SES not configured for tenant' };
    }

    // fromEmail is tenant-configurable; falls through to env; otherwise
    // refuse to send so we never misattribute mail from an unowned domain.
    const from =
      config.fromEmail ??
      process.env.RESEND_FROM_EMAIL?.trim() ??
      process.env.NOTIFICATIONS_FROM_EMAIL?.trim() ??
      null;
    if (!from) {
      return {
        success: false,
        error: 'SES fromEmail not configured (set tenant fromEmail or NOTIFICATIONS_FROM_EMAIL env)',
      };
    }
    const fromName = config.fromName ?? process.env.NOTIFICATIONS_FROM_NAME ?? 'BORJIE';

    try {
      const client = await getSesClient(config);
      const { SendEmailCommand } = await import('@aws-sdk/client-ses');

      const command = new SendEmailCommand({
        Source: `"${fromName}" <${from}>`,
        Destination: {
          ToAddresses: [params.to],
        },
        Message: {
          Subject: {
            Data: params.subject ?? 'Notification',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: params.body,
              Charset: 'UTF-8',
            },
            Html: {
              Data: params.body.replace(/\n/g, '<br>'),
              Charset: 'UTF-8',
            },
          },
        },
      });

      const response = await client.send(command);
      return {
        success: true,
        externalId: response.MessageId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const sesProvider = new SesProvider();
