/**
 * User notification preference types
 */

import type { NotificationChannel, NotificationTemplateId } from '../types/index.js';

export interface ChannelPreferences {
  email?: boolean;
  sms?: boolean;
  push?: boolean;
  whatsapp?: boolean;
}

export type TemplatePreferences = Partial<Record<NotificationTemplateId, boolean>>;

export interface NotificationPreferences {
  userId: string;
  tenantId: string;
  channels: ChannelPreferences;
  templates: TemplatePreferences;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  updatedAt: Date;
}

export interface UpdatePreferencesInput {
  channels?: Partial<ChannelPreferences>;
  templates?: Partial<TemplatePreferences>;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}
