/**
 * Main Notification Service
 * Multi-tenant, multi-channel, multi-locale
 */

import { v4 as uuidv4 } from 'uuid';
import type { TenantId } from '../types/index.js';
import type {
  NotificationRecipient,
  NotificationChannel,
  NotificationTemplateId,
  SupportedLocale,
} from '../types/index.js';
import { resolveTemplate } from '../templates/index.js';
import { providerRegistry } from '../providers/index.js';
import type { SendParams } from '../providers/provider.interface.js';
import {
  addHistoryRecord,
  updateHistoryRecord,
  getNotificationHistory as getHistory,
  getNotificationById,
  addScheduled,
  removeScheduled,
} from '../repositories/notification.repository.js';
import { createLogger } from '../logger.js';

const logger = createLogger('notification-service');

function getProvider(channel: NotificationChannel) {
  const providers = providerRegistry[channel];
  if (!providers?.length) throw new Error(`No providers for channel: ${channel}`);
  const configured = providers.find((p) => p.isConfigured);
  const p = configured ?? providers[0];
  if (!p) throw new Error(`Unknown channel: ${channel}`);
  return p;
}

function getFirstConfiguredProvider(
  recipient: NotificationRecipient,
  channel: NotificationChannel
) {
  const providers = providerRegistry[channel];
  if (!providers?.length) return null;
  return providers.find((p) => p.isConfigured(recipient.tenantId)) ?? null;
}

function getDestination(recipient: NotificationRecipient, channel: NotificationChannel): string | null {
  switch (channel) {
    case 'sms':
    case 'whatsapp':
      return recipient.phone ?? null;
    case 'email':
      return recipient.email ?? null;
    case 'push':
      return recipient.pushToken ?? null;
    default:
      return null;
  }
}

export const notificationService = {
  async sendNotification(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
    templateId: NotificationTemplateId,
    data: Record<string, string>
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const dest = getDestination(recipient, channel);
    if (!dest) {
      logger.warn('No destination for channel', { channel, recipient: recipient.userId ?? recipient.customerId });
      return { success: false, error: `No destination for channel ${channel}` };
    }

    const provider = getFirstConfiguredProvider(recipient, channel);
    if (!provider) {
      logger.warn('Channel not configured for tenant', { channel, tenantId: recipient.tenantId });
      return { success: false, error: `${channel} not configured for tenant` };
    }

    const locale: SupportedLocale = recipient.locale ?? 'en';
    const { subject, body, smsBody } = resolveTemplate(templateId, locale, data);

    const params: SendParams = {
      tenantId: recipient.tenantId,
      to: dest,
      body: channel === 'sms' || channel === 'whatsapp' ? smsBody : body,
      subject: channel === 'email' ? subject : undefined,
      title: channel === 'push' ? subject : undefined,
      data,
    };

    const recordId = addHistoryRecord({
      tenantId: recipient.tenantId as string,
      customerId: recipient.customerId,
      userId: recipient.userId,
      channel,
      templateId,
      status: 'pending',
    });

    try {
      const result = await provider.send(params);

      if (result.success) {
        updateHistoryRecord(recordId, {
          status: 'sent',
          externalId: result.externalId,
          sentAt: new Date(),
        });
        logger.info('Notification sent', { recordId, channel, templateId });
        return { success: true, id: recordId };
      }

      updateHistoryRecord(recordId, {
        status: 'failed',
        error: result.error,
      });
      logger.warn('Notification failed', { recordId, error: result.error });
      return { success: false, id: recordId, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateHistoryRecord(recordId, {
        status: 'failed',
        error: message,
      });
      logger.error('Notification threw', { recordId, error: message });
      return { success: false, id: recordId, error: message };
    }
  },

  async sendBulk(
    recipients: NotificationRecipient[],
    channel: NotificationChannel,
    templateId: NotificationTemplateId,
    data: Record<string, string>
  ): Promise<{ success: number; failed: number; results: { index: number; success: boolean; error?: string }[] }> {
    const results: { index: number; success: boolean; error?: string }[] = [];
    let successCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      if (!recipient) continue;
      const r = await this.sendNotification(recipient, channel, templateId, data);
      results.push({ index: i, success: r.success, error: r.error });
      if (r.success) successCount++;
    }

    logger.info('Bulk send completed', {
      total: recipients.length,
      success: successCount,
      failed: recipients.length - successCount,
    });

    return {
      success: successCount,
      failed: recipients.length - successCount,
      results,
    };
  },

  /**
   * Schedule a notification for future delivery.
   *
   * Round-3 audit H8 fix — the previous implementation used a bare
   * `setTimeout(...)` which is process-scoped. A crash or pod-restart
   * between the schedule call and the fire-time silently lost the
   * notification with no replay. `addScheduled` already persists the
   * schedule entry to the in-process registry — production wiring
   * MUST replace that with a durable store (BullMQ / db queue) AND
   * the timer with a cron poller. The persistence boundary is
   * `scheduledStore` (see `./scheduled-store.ts`). The setTimeout
   * here is a best-effort optimisation for sub-poll-interval delays
   * and is NOT the durability contract.
   *
   * Operators MUST provision the scheduled-store poller in
   * production. Without it, this function still records the schedule
   * but only fires within the lifetime of the current process.
   */
  async scheduleNotification(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
    templateId: NotificationTemplateId,
    data: Record<string, string>,
    scheduledAt: Date
  ): Promise<{ id: string }> {
    const id = uuidv4();
    const send = async () => {
      try {
        await this.sendNotification(recipient, channel, templateId, data);
      } catch (err) {
        logger.error('Scheduled notification failed', { id, error: String(err) });
      } finally {
        removeScheduled(id);
      }
    };
    addScheduled(id, scheduledAt, send);

    const delay = scheduledAt.getTime() - Date.now();
    if (delay > 0) {
      // Best-effort in-process timer. Durability is the poller's job.
      setTimeout(() => void send(), delay);
    } else {
      void send();
    }

    logger.info('Notification scheduled (in-process timer + scheduled-store entry)', {
      id,
      scheduledAt,
      durable: 'requires poller; see scheduled-store.ts',
    });
    return { id };
  },

  getNotificationHistory(tenantId: TenantId, customerId?: string, limit = 50, offset = 0) {
    return getHistory({
      tenantId: tenantId as string,
      customerId,
      limit,
      offset,
    });
  },
};

/** Alias for queue consumer */
export const notificationProcessor = notificationService;
