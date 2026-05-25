# BORJIE Notifications Service

Multi-channel notifications (SMS, Email, Push, WhatsApp) with multi-tenant isolation, queue support, and English/Swahili templates.

## Features

- **Channels**: SMS (Africa's Talking, Twilio), Email (SendGrid, AWS SES, SMTP), Push (Firebase), WhatsApp (Twilio)
- **Templates**: rent_due, rent_overdue, payment_received, maintenance_update, lease_expiring, welcome
- **Queue**: BullMQ for async delivery with retries
- **Preferences**: Per-user channel and template opt-in
- **Locales**: English (en), Swahili (sw)

## Installation

```bash
pnpm install  # from repo root
# Or in services/notifications:
npm install @aws-sdk/client-ses bullmq ioredis
```

Set `REDIS_URL` for queue (e.g. `redis://localhost:6379`).

## Usage

```ts
import { notifications, registerProviderConfig, createNotificationWorker } from '@borjie/notifications-service';

// Register providers
registerProviderConfig({
  tenantId: 'tenant-123',
  sms: { provider: 'africastalking', apiKey: '...', username: 'sandbox' },
  email: { provider: 'sendgrid', sendgridApiKey: '...', fromEmail: 'noreply@example.com' },
});

// Send (immediate)
await notifications.send({
  recipient: { tenantId: 'tenant-123', phone: '+254712345678', locale: 'sw' },
  channel: 'sms',
  templateId: 'rent_due',
  data: { amount: 'KES 15,000', dueDate: '2025-02-15' },
});

// Send via queue (async, retries)
await notifications.sendQueued({ recipient, channel: 'email', templateId: 'payment_received', data });

// Bulk
await notifications.sendBulk(recipients, 'email', 'rent_due', data);

// Schedule
await notifications.schedule(notification, new Date('2025-03-01'));

// Delivery status
const status = notifications.getDeliveryStatus(notificationId);

// Preferences
const prefs = notifications.getUserPreferences(userId, tenantId);
notifications.updatePreferences(userId, tenantId, { channels: { whatsapp: true } });
```

## Queue Worker

Start the consumer to process queued notifications:

```ts
import { createNotificationWorker } from '@borjie/notifications-service';

const worker = createNotificationWorker({ concurrency: 5 });
```

## Retry Failed

```ts
import { retryFailedNotifications } from '@borjie/notifications-service';

const { retried, failed } = await retryFailedNotifications();
```

## Templates

| ID | Variables |
|----|-----------|
| rent_due | amount, dueDate |
| rent_overdue | amount, dueDate, days |
| payment_received | amount, reference?, date? |
| maintenance_update | workOrderNumber, status, date?, time? |
| lease_expiring | expiryDate |
| welcome | name?, propertyName? |