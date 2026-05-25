/**
 * Maintenance update template - maintenance_update
 * English and Swahili
 */

import type { SupportedLocale } from '../types/index.js';
import { renderTemplate } from './renderer.js';

export interface MaintenanceTemplateData {
  workOrderNumber: string;
  status: string;
  date?: string;
  time?: string;
}

const templates: Record<SupportedLocale, { subject: string; body: string; smsBody: string }> = {
  en: {
    subject: 'Maintenance Update',
    body: 'Your maintenance request #{{workOrderNumber}} has been updated: {{status}}.',
    smsBody: 'Maintenance #{{workOrderNumber}}: {{status}}',
  },
  sw: {
    subject: 'Sasisho la Ukarabati',
    body: 'Ombi lako la ukarabati #{{workOrderNumber}} limesasishwa: {{status}}.',
    smsBody: 'Ukarabati #{{workOrderNumber}}: {{status}}',
  },
};

export function getMaintenanceTemplate(
  locale: SupportedLocale,
  data: MaintenanceTemplateData
): { subject: string; body: string; smsBody: string } {
  const t = templates[locale];
  const vars: Record<string, string> = {
    workOrderNumber: data.workOrderNumber,
    status: data.status,
    ...(data.date && { date: data.date }),
    ...(data.time && { time: data.time }),
  };
  return {
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars),
    smsBody: renderTemplate(t.smsBody, vars),
  };
}
