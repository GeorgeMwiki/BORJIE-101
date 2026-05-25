/**
 * Notification providers - unified exports
 */

export * from './provider.interface.js';
export * from './email/sendgrid.js';
export * from './email/ses.js';
export * from './email/smtp.js';
export * from './sms/africas-talking.js';
export * from './sms/twilio.js';
export * from './push/firebase.js';
export * from './whatsapp/twilio.js';

import { sendGridProvider } from './email/sendgrid.js';
import { sesProvider } from './email/ses.js';
import { smtpProvider } from './email/smtp.js';
import { africasTalkingSmsProvider } from './sms/africas-talking.js';
import { twilioSmsProvider } from './sms/twilio.js';
import { firebasePushProvider } from './push/firebase.js';
import { twilioWhatsAppProvider } from './whatsapp/twilio.js';
import type { NotificationChannel } from '../types/index.js';
import type { INotificationProvider } from './provider.interface.js';

/** Provider registry: channel -> available providers */
export const providerRegistry: Record<NotificationChannel, INotificationProvider[]> = {
  email: [sendGridProvider, sesProvider, smtpProvider],
  sms: [africasTalkingSmsProvider, twilioSmsProvider],
  push: [firebasePushProvider],
  whatsapp: [twilioWhatsAppProvider],
};
