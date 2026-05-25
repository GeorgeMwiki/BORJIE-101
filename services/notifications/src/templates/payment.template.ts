/**
 * Payment confirmation template - payment_received
 * English and Swahili
 */

import type { SupportedLocale } from '../types/index.js';
import { renderTemplate } from './renderer.js';

export interface PaymentTemplateData {
  amount: string;
  reference?: string;
  date?: string;
}

const templates: Record<SupportedLocale, { subject: string; body: string; smsBody: string }> = {
  en: {
    subject: 'Payment Received',
    body: 'We received your payment of {{amount}}. Thank you for your payment.',
    smsBody: 'Payment of {{amount}} received. Thank you!',
  },
  sw: {
    subject: 'Malipo Imepokelewa',
    body: 'Tumepokea malipo yako ya {{amount}}. Asante kwa malipo yako.',
    smsBody: 'Malipo ya {{amount}} yamepokelewa. Asante!',
  },
};

export function getPaymentTemplate(
  locale: SupportedLocale,
  data: PaymentTemplateData
): { subject: string; body: string; smsBody: string } {
  const t = templates[locale];
  const vars: Record<string, string> = {
    amount: data.amount,
    ...(data.reference && { reference: data.reference }),
    ...(data.date && { date: data.date }),
  };
  return {
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars),
    smsBody: renderTemplate(t.smsBody, vars),
  };
}
