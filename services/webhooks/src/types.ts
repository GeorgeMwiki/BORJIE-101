/**
 * Webhook event types and subscription types for BORJIE
 */

export type WebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'lease.created'
  | 'lease.renewed'
  | 'maintenance.created'
  | 'maintenance.resolved'
  | 'tenant.registered'
  | 'document.uploaded';

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType;
  tenantId: string;
  payload: T;
  timestamp: string;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret?: string;
  tenantId: string;
  active: boolean;
  createdAt: string;
}
