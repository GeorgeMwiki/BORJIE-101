/**
 * Webhook subscription management and event triggering with retry
 */

import { v4 as uuidv4 } from 'uuid';
import type { WebhookEvent, WebhookEventType, WebhookSubscription } from './types.js';
import { assertSafeWebhookUrl, deliver } from './delivery.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const subscriptions = new Map<string, WebhookSubscription>();

export function subscribe(
  url: string,
  events: WebhookEventType[],
  tenantId: string,
  secret?: string
): WebhookSubscription {
  // Reject the subscription up-front if the URL would be blocked by the
  // SSRF guard. This gives the tenant a synchronous, actionable error
  // instead of a silent run of "failed" deliveries.
  assertSafeWebhookUrl(url);
  const sub: WebhookSubscription = {
    id: uuidv4(),
    url,
    events,
    tenantId,
    active: true,
    createdAt: new Date().toISOString(),
    ...(secret !== undefined && { secret }),
  };
  subscriptions.set(sub.id, sub);
  return sub;
}

export function unsubscribe(id: string): boolean {
  return subscriptions.delete(id);
}

export function getSubscriptions(tenantId?: string): WebhookSubscription[] {
  const list = Array.from(subscriptions.values()).filter((s) => s.active);
  return tenantId ? list.filter((s) => s.tenantId === tenantId) : list;
}

export async function trigger(
  event: WebhookEvent,
  retries = MAX_RETRIES
): Promise<{ delivered: number; failed: number }> {
  const subs = getSubscriptions(event.tenantId).filter((s) =>
    s.events.includes(event.type)
  );

  let delivered = 0;
  let failed = 0;

  for (const sub of subs) {
    let lastError: string | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
      const result = await deliver(sub.url, event, sub.secret);
      if (result.success) {
        delivered++;
        break;
      }
      lastError = result.error;
    }
    if (lastError) failed++;
  }

  return { delivered, failed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
