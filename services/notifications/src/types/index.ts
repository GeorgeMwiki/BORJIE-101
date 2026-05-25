/**
 * Notification service types
 * TenantId is compatible with @borjie/domain-models when available
 */

export type TenantId = string & { readonly __brand?: 'TenantId' };

/** Supported notification channels */
export type NotificationChannel = 'sms' | 'email' | 'push' | 'whatsapp';

/** Supported locales for i18n */
export type SupportedLocale = 'en' | 'sw';

/** Template identifiers */
export type NotificationTemplateId =
  | 'rent_due'
  | 'rent_overdue'
  | 'payment_received'
  | 'maintenance_update'
  | 'lease_expiring'
  | 'welcome'
  | 'auth_otp'
  | 'case_created'
  | 'case_escalated'
  | 'case_resolved'
  | 'notice_sent'
  | 'case_sla_breached'
  | 'renewal_window_opened'
  | 'renewal_proposed'
  | 'payment_overdue'
  | 'work_order_assigned'
  | 'inspection_scheduled'
  | 'waitlist_vacancy'
  | 'letter_approved';

/** Recipient information */
export interface NotificationRecipient {
  tenantId: TenantId;
  /** User ID (optional, for in-app or push) */
  userId?: string;
  /** Customer ID (optional) */
  customerId?: string;
  /** Email address (required for email channel) */
  email?: string;
  /** Phone number in E.164 format (required for SMS/WhatsApp) */
  phone?: string;
  /** Push token (required for push channel) */
  pushToken?: string;
  /** Display name for personalization */
  name?: string;
  /** Locale preference */
  locale?: SupportedLocale;
}

/** Notification send result */
export interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

/** Scheduled notification record */
export interface ScheduledNotification {
  id: string;
  tenantId: string;
  recipient: NotificationRecipient;
  channel: NotificationChannel;
  templateId: NotificationTemplateId;
  data: Record<string, string>;
  scheduledAt: Date;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  createdAt: Date;
}

/** Notification history record */
export interface NotificationHistoryRecord {
  id: string;
  tenantId: string;
  customerId?: string;
  userId?: string;
  channel: NotificationChannel;
  templateId: NotificationTemplateId;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  externalId?: string;
  error?: string;
  createdAt: Date;
  sentAt?: Date;
}

/** Provider configuration (tenant-specific) */
export interface ProviderConfig {
  tenantId: TenantId;
  /** Africa's Talking: apiKey, username */
  sms?: {
    provider?: 'africastalking' | 'twilio';
    apiKey?: string;
    username?: string;
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
  };
  /** SendGrid / SES: provider-specific keys */
  email?: {
    provider: 'sendgrid' | 'smtp' | 'ses';
    sendgridApiKey?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    sesRegion?: string;
    sesAccessKeyId?: string;
    sesSecretAccessKey?: string;
    fromEmail?: string;
    fromName?: string;
  };
  /** Firebase: projectId, credentials */
  push?: {
    projectId: string;
    clientEmail?: string;
    privateKey?: string;
  };
  /** Twilio: accountSid, authToken, whatsappNumber */
  whatsapp?: {
    accountSid: string;
    authToken: string;
    whatsappNumber: string;
  };
}

/** Single notification payload for send() */
export interface NotificationPayload {
  recipient: NotificationRecipient;
  channel: NotificationChannel;
  templateId: NotificationTemplateId;
  data: Record<string, string>;
}
