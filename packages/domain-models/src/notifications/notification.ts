/**
 * Notification domain model
 * Multi-channel notification management
 */

import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';

export type NotificationId = Brand<string, 'NotificationId'>;

export function asNotificationId(id: string): NotificationId {
  return id as NotificationId;
}

/** Notification channel */
export type NotificationChannel = 'email' | 'sms' | 'push' | 'in_app' | 'whatsapp';

/** Notification status */
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled';

/** Notification priority */
export type NotificationPriority = 'high' | 'normal' | 'low';

/** Notification category */
export type NotificationCategory =
  | 'payment_due'
  | 'payment_received'
  | 'payment_overdue'
  | 'maintenance_update'
  | 'maintenance_scheduled'
  | 'maintenance_completed'
  | 'lease_expiring'
  | 'lease_renewal'
  | 'inspection_scheduled'
  | 'document_ready'
  | 'announcement'
  | 'alert'
  | 'reminder';

/**
 * Notification entity
 */
export interface Notification extends EntityMetadata {
  readonly id: NotificationId;
  readonly tenantId: TenantId;
  readonly recipientUserId: UserId | null;
  readonly recipientCustomerId: CustomerId | null;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly priority: NotificationPriority;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string>; // Additional payload
  readonly actionUrl: string | null;
  readonly scheduledFor: ISOTimestamp | null;
  readonly sentAt: ISOTimestamp | null;
  readonly deliveredAt: ISOTimestamp | null;
  readonly readAt: ISOTimestamp | null;
  readonly failureReason: string | null;
  readonly retryCount: number;
  readonly externalId: string | null; // Provider's message ID
}

/** Create a new notification */
export function createNotification(
  id: NotificationId,
  data: {
    tenantId: TenantId;
    recipientUserId?: UserId;
    recipientCustomerId?: CustomerId;
    channel: NotificationChannel;
    priority?: NotificationPriority;
    category: NotificationCategory;
    title: string;
    body: string;
    data?: Record<string, string>;
    actionUrl?: string;
    scheduledFor?: ISOTimestamp;
  },
  createdBy: UserId
): Notification {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    recipientUserId: data.recipientUserId ?? null,
    recipientCustomerId: data.recipientCustomerId ?? null,
    channel: data.channel,
    status: data.scheduledFor ? 'pending' : 'pending',
    priority: data.priority ?? 'normal',
    category: data.category,
    title: data.title,
    body: data.body,
    data: data.data ?? {},
    actionUrl: data.actionUrl ?? null,
    scheduledFor: data.scheduledFor ?? null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failureReason: null,
    retryCount: 0,
    externalId: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Mark notification as sent */
export function markSent(
  notification: Notification,
  externalId: string | null,
  updatedBy: UserId
): Notification {
  return {
    ...notification,
    status: 'sent',
    sentAt: new Date().toISOString(),
    externalId,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Mark notification as delivered */
export function markDelivered(
  notification: Notification,
  updatedBy: UserId
): Notification {
  return {
    ...notification,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Mark notification as read */
export function markRead(
  notification: Notification,
  updatedBy: UserId
): Notification {
  return {
    ...notification,
    status: 'read',
    readAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Mark notification as failed */
export function markFailed(
  notification: Notification,
  failureReason: string,
  updatedBy: UserId
): Notification {
  return {
    ...notification,
    status: 'failed',
    failureReason,
    retryCount: notification.retryCount + 1,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Check if notification should be retried */
export function shouldRetry(notification: Notification, maxRetries: number = 3): boolean {
  return notification.status === 'failed' && notification.retryCount < maxRetries;
}

/** Notification templates */
export const NOTIFICATION_TEMPLATES: Record<NotificationCategory, { title: string; body: string }> = {
  payment_due: {
    title: 'Payment Due Reminder',
    body: 'Your rent payment of {{amount}} is due on {{dueDate}}.',
  },
  payment_received: {
    title: 'Payment Received',
    body: 'We received your payment of {{amount}}. Thank you!',
  },
  payment_overdue: {
    title: 'Payment Overdue',
    body: 'Your payment of {{amount}} is {{days}} days overdue. Please pay immediately to avoid late fees.',
  },
  maintenance_update: {
    title: 'Maintenance Update',
    body: 'Your maintenance request #{{workOrderNumber}} has been updated: {{status}}.',
  },
  maintenance_scheduled: {
    title: 'Maintenance Scheduled',
    body: 'Maintenance for your request #{{workOrderNumber}} is scheduled for {{date}} at {{time}}.',
  },
  maintenance_completed: {
    title: 'Maintenance Completed',
    body: 'Your maintenance request #{{workOrderNumber}} has been completed. Please rate your experience.',
  },
  lease_expiring: {
    title: 'Lease Expiring Soon',
    body: 'Your lease will expire on {{expiryDate}}. Please contact us about renewal options.',
  },
  lease_renewal: {
    title: 'Lease Renewal Available',
    body: 'Your lease renewal is ready for review. Please sign by {{deadline}}.',
  },
  inspection_scheduled: {
    title: 'Inspection Scheduled',
    body: 'A {{type}} inspection has been scheduled for {{date}} at {{time}}.',
  },
  document_ready: {
    title: 'Document Ready',
    body: 'Your {{documentType}} is ready to view.',
  },
  announcement: {
    title: '{{title}}',
    body: '{{message}}',
  },
  alert: {
    title: 'Important Alert',
    body: '{{message}}',
  },
  reminder: {
    title: 'Reminder',
    body: '{{message}}',
  },
};

/** Replace template placeholders */
export function applyTemplate(
  category: NotificationCategory,
  variables: Record<string, string>
): { title: string; body: string } {
  const template = NOTIFICATION_TEMPLATES[category];
  let title = template.title;
  let body = template.body;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    title = title.replace(placeholder, value);
    body = body.replace(placeholder, value);
  }

  return { title, body };
}
