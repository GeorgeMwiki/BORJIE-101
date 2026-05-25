/**
 * Lease expiry template - lease_expiring
 * English and Swahili
 */

import type { SupportedLocale } from '../types/index.js';
import { renderTemplate } from './renderer.js';

export interface LeaseTemplateData {
  expiryDate: string;
  propertyName?: string;
  unitNumber?: string;
}

const templates: Record<SupportedLocale, { subject: string; body: string; smsBody: string }> = {
  en: {
    subject: 'Lease Expiring Soon',
    body: 'Your lease will expire on {{expiryDate}}. Please contact us about renewal options.',
    smsBody: 'Lease expires {{expiryDate}}. Contact us for renewal.',
  },
  sw: {
    subject: 'Hati ya Kodi Inakaribia Kumalizika',
    body: 'Hati yako ya kodi itamalizika tarehe {{expiryDate}}. Wasiliana nasi kuhusu uhuishaji.',
    smsBody: 'Hati inamalizika {{expiryDate}}. Wasiliana nasi kwa uhuishaji.',
  },
};

export function getLeaseTemplate(
  locale: SupportedLocale,
  data: LeaseTemplateData
): { subject: string; body: string; smsBody: string } {
  const t = templates[locale];
  const vars: Record<string, string> = {
    expiryDate: data.expiryDate,
    ...(data.propertyName && { propertyName: data.propertyName }),
    ...(data.unitNumber && { unitNumber: data.unitNumber }),
  };
  return {
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars),
    smsBody: renderTemplate(t.smsBody, vars),
  };
}
