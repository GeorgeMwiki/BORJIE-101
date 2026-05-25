/**
 * Template manager - resolves template by ID and locale, renders with variables
 */

import type { NotificationTemplateId, SupportedLocale } from '../types/index.js';
import { renderTemplate } from './renderer.js';
import { getRentTemplate } from './rent-reminder.template.js';
import { getPaymentTemplate } from './payment.template.js';
import { getMaintenanceTemplate } from './maintenance.template.js';
import { getLeaseTemplate } from './lease.template.js';
import { getWelcomeTemplate } from './templates/welcome.template.js';

export type TemplateData = Record<string, string>;

export interface RenderedTemplate {
  subject: string;
  body: string;
  smsBody: string;
}

/**
 * Resolve and render a notification template
 */
export function resolveTemplate(
  templateId: NotificationTemplateId,
  locale: SupportedLocale,
  data: TemplateData
): RenderedTemplate {
  const loc = locale ?? 'en';
  switch (templateId) {
    case 'rent_due':
      return getRentTemplate('rent_due', loc, data as unknown as Parameters<typeof getRentTemplate>[2]);
    case 'rent_overdue':
      return getRentTemplate('rent_overdue', loc, data as unknown as Parameters<typeof getRentTemplate>[2]);
    case 'payment_received':
      return getPaymentTemplate(loc, data as unknown as Parameters<typeof getPaymentTemplate>[1]);
    case 'maintenance_update':
      return getMaintenanceTemplate(loc, data as unknown as Parameters<typeof getMaintenanceTemplate>[1]);
    case 'lease_expiring':
      return getLeaseTemplate(loc, data as unknown as Parameters<typeof getLeaseTemplate>[1]);
    case 'welcome':
      return getWelcomeTemplate(loc, data as unknown as Parameters<typeof getWelcomeTemplate>[1]);
    default:
      throw new Error(`Unknown template: ${templateId}`);
  }
}
