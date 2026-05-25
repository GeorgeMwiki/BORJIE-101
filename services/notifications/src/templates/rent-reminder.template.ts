/**
 * Rent reminder templates - rent_due, rent_overdue
 * English and Swahili
 */

import type { NotificationTemplateId, SupportedLocale } from '../types/index.js';
import { renderTemplate } from './renderer.js';

export interface RentTemplateData {
  amount: string;
  dueDate: string;
  days?: string;
  propertyName?: string;
  unitNumber?: string;
}

const templates: Record<
  'rent_due' | 'rent_overdue',
  Record<SupportedLocale, { subject: string; body: string; smsBody: string }>
> = {
  rent_due: {
    en: {
      subject: 'Rent Due Reminder',
      body: 'Your rent payment of {{amount}} is due on {{dueDate}}.',
      smsBody: 'Rent due: {{amount}} on {{dueDate}}. Pay on time to avoid late fees.',
    },
    sw: {
      subject: 'Ukumbusho wa Kodi',
      body: 'Malipo yako ya kodi ya {{amount}} yanakabiliwa tarehe {{dueDate}}.',
      smsBody: 'Kodi: {{amount}} tarehe {{dueDate}}. maliza malipo kwa wakati.',
    },
  },
  rent_overdue: {
    en: {
      subject: 'Rent Overdue Notice',
      body: 'Your rent payment of {{amount}} is {{days}} days overdue. Please pay immediately to avoid late fees.',
      smsBody: 'URGENT: Rent {{amount}} is {{days}} days overdue. Please pay now.',
    },
    sw: {
      subject: 'Onyo la Kodi Iliyochelewa',
      body: 'Malipo yako ya kodi ya {{amount}} yamechelewa siku {{days}}. Tafadhali maliza haraka.',
      smsBody: 'MUHIMU: Kodi {{amount}} imechelewa siku {{days}}. Maliza haraka.',
    },
  },
};

export function getRentTemplate(
  templateId: 'rent_due' | 'rent_overdue',
  locale: SupportedLocale,
  data: RentTemplateData
): { subject: string; body: string; smsBody: string } {
  const t = templates[templateId][locale];
  const vars: Record<string, string> = {
    amount: data.amount,
    dueDate: data.dueDate,
    ...(data.days && { days: data.days }),
    ...(data.propertyName && { propertyName: data.propertyName }),
    ...(data.unitNumber && { unitNumber: data.unitNumber }),
  };
  return {
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars),
    smsBody: renderTemplate(t.smsBody, vars),
  };
}
