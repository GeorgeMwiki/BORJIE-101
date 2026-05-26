/**
 * User notification preferences service.
 *
 * Round-3 audit H6 fix — previously this module held all preference
 * state in a module-scoped `Map`. That meant every pod had its own
 * copy of user opt-outs (one pod could send a notification the user
 * had explicitly disabled on another pod), and a pod restart erased
 * every stored preference back to defaults.
 *
 * The service now delegates persistence to a `PreferencesStore`
 * adapter (`../storage/types.ts`). The default adapter is in-memory
 * (extracted from the old module-scoped Map so existing single-pod
 * behaviour is preserved). Multi-pod deployments flip on Redis by
 * setting `REDIS_URL`; the factory emits a `store-not-durable` warn
 * at boot when Redis is NOT configured so the gap is observable.
 *
 * All read-modify-write paths now route through `store.update(...)`
 * which is atomic per adapter (Redis uses WATCH/MULTI; in-memory is
 * naturally atomic because Node runs one tick at a time).
 */

import type { NotificationChannel, NotificationTemplateId } from '../types/index.js';
import type {
  NotificationPreferences,
  ChannelPreferences,
  TemplatePreferences,
  UpdatePreferencesInput,
} from './types.js';
import type { PreferencesStore } from '../storage/types.js';
import { createPreferencesStore } from '../storage/factory.js';

const DEFAULT_CHANNELS: ChannelPreferences = {
  email: true,
  sms: true,
  push: true,
  whatsapp: false,
};

const DEFAULT_TEMPLATES: TemplatePreferences = {
  rent_due: true,
  rent_overdue: true,
  payment_received: true,
  maintenance_update: true,
  lease_expiring: true,
  welcome: true,
};

function defaultsFor(userId: string, tenantId: string): NotificationPreferences {
  return {
    userId,
    tenantId,
    channels: { ...DEFAULT_CHANNELS },
    templates: { ...DEFAULT_TEMPLATES },
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export interface PreferencesServiceDeps {
  store?: PreferencesStore;
}

/**
 * Public service shape. Methods that mutate are async to support
 * Redis-backed adapters; the existing dispatcher awaits them.
 */
export interface PreferencesService {
  getUserPreferences(userId: string, tenantId: string): Promise<NotificationPreferences>;
  getPreferences(userId: string, tenantId: string): Promise<NotificationPreferences>;
  updatePreferences(
    userId: string,
    tenantId: string,
    prefs: UpdatePreferencesInput
  ): Promise<NotificationPreferences>;
  upsertPreferences(
    userId: string,
    tenantId: string,
    input: UpdatePreferencesInput
  ): Promise<NotificationPreferences>;
  isChannelEnabled(
    userId: string,
    tenantId: string,
    channel: NotificationChannel
  ): Promise<boolean>;
  isTemplateEnabled(
    userId: string,
    tenantId: string,
    templateId: NotificationTemplateId
  ): Promise<boolean>;
  isQuietHours(
    userId: string,
    tenantId: string,
    now?: Date
  ): Promise<boolean>;
  checkAllowed(args: {
    userId: string;
    tenantId: string;
    channel: NotificationChannel;
    templateId: NotificationTemplateId;
    priority?: 'emergency' | 'high' | 'normal' | 'low';
    now?: Date;
  }): Promise<{
    allowed: boolean;
    reason?: 'channel_disabled' | 'template_disabled' | 'quiet_hours';
  }>;
}

export function createPreferencesService(
  deps: PreferencesServiceDeps = {}
): PreferencesService {
  const store: PreferencesStore = deps.store ?? createPreferencesStore();

  async function getUserPreferences(
    userId: string,
    tenantId: string
  ): Promise<NotificationPreferences> {
    const existing = await store.get(userId, tenantId);
    if (existing) return existing;
    const defaults = defaultsFor(userId, tenantId);
    await store.set(defaults);
    return defaults;
  }

  async function updatePreferences(
    userId: string,
    tenantId: string,
    prefs: UpdatePreferencesInput
  ): Promise<NotificationPreferences> {
    return store.update(userId, tenantId, (existing) => {
      const base = existing ?? defaultsFor(userId, tenantId);
      const quietHoursStart = prefs.quietHoursStart ?? base.quietHoursStart;
      const quietHoursEnd = prefs.quietHoursEnd ?? base.quietHoursEnd;
      return {
        ...base,
        channels: prefs.channels
          ? { ...base.channels, ...prefs.channels }
          : base.channels,
        templates: prefs.templates
          ? { ...base.templates, ...prefs.templates }
          : base.templates,
        ...(quietHoursStart !== undefined ? { quietHoursStart } : {}),
        ...(quietHoursEnd !== undefined ? { quietHoursEnd } : {}),
        updatedAt: new Date(),
      };
    });
  }

  async function isChannelEnabled(
    userId: string,
    tenantId: string,
    channel: NotificationChannel
  ): Promise<boolean> {
    const prefs = await getUserPreferences(userId, tenantId);
    const channelKey = channel as keyof ChannelPreferences;
    return prefs.channels[channelKey] ?? DEFAULT_CHANNELS[channelKey] ?? false;
  }

  async function isTemplateEnabled(
    userId: string,
    tenantId: string,
    templateId: NotificationTemplateId
  ): Promise<boolean> {
    const prefs = await getUserPreferences(userId, tenantId);
    const t = prefs.templates as Record<string, boolean | undefined>;
    const d = DEFAULT_TEMPLATES as Record<string, boolean>;
    return t[templateId] ?? d[templateId] ?? true;
  }

  async function isQuietHours(
    userId: string,
    tenantId: string,
    now: Date = new Date()
  ): Promise<boolean> {
    const prefs = await getUserPreferences(userId, tenantId);
    if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;

    const startParts = prefs.quietHoursStart.split(':').map(Number);
    const endParts = prefs.quietHoursEnd.split(':').map(Number);
    const startH = startParts[0] ?? 0;
    const startM = startParts[1] ?? 0;
    const endH = endParts[0] ?? 0;
    const endM = endParts[1] ?? 0;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  async function checkAllowed(args: {
    userId: string;
    tenantId: string;
    channel: NotificationChannel;
    templateId: NotificationTemplateId;
    priority?: 'emergency' | 'high' | 'normal' | 'low';
    now?: Date;
  }): Promise<{
    allowed: boolean;
    reason?: 'channel_disabled' | 'template_disabled' | 'quiet_hours';
  }> {
    const priority = args.priority ?? 'normal';

    if (!(await isChannelEnabled(args.userId, args.tenantId, args.channel))) {
      return { allowed: false, reason: 'channel_disabled' };
    }

    if (
      !(await isTemplateEnabled(args.userId, args.tenantId, args.templateId))
    ) {
      return { allowed: false, reason: 'template_disabled' };
    }

    // Emergency priority bypasses quiet hours — but only quiet hours.
    if (
      priority !== 'emergency' &&
      (await isQuietHours(args.userId, args.tenantId, args.now))
    ) {
      return { allowed: false, reason: 'quiet_hours' };
    }

    return { allowed: true };
  }

  return {
    getUserPreferences,
    getPreferences: getUserPreferences,
    updatePreferences,
    upsertPreferences: updatePreferences,
    isChannelEnabled,
    isTemplateEnabled,
    isQuietHours,
    checkAllowed,
  };
}

/**
 * Default service singleton wired against the default storage factory
 * (Redis if `REDIS_URL` is set, in-memory otherwise). Existing callers
 * (`dispatcher.ts`, `index.ts` re-export) keep working unchanged.
 */
export const preferencesService: PreferencesService = createPreferencesService();
