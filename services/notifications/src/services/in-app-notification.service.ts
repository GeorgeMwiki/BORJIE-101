/**
 * In-App Notification Service
 *
 * Handles in-app notifications for the BORJIE platform.
 * Supports real-time delivery, notification management, and user preferences.
 *
 * Round-3 audit H7 fix — previously this module held three
 * module-scoped Maps (`notifications`, `userNotifications`,
 * `tenantNotifications`). That meant every pod had its own copy of the
 * in-app inbox (a notification created on pod A was invisible to
 * pod B), and a pod restart erased every row. Worse, the
 * `cleanupExpired` setInterval fired on every pod independently and
 * raced on its OWN local Map, so the "cleanup" did not actually
 * converge across the fleet.
 *
 * Persistence is now delegated to an `InAppNotificationStore` adapter
 * (`../storage/types.ts`). The default adapter is in-memory (extracted
 * verbatim from the old Maps); set `REDIS_URL` to flip on the
 * Redis-backed adapter. The factory emits a `store-not-durable` warn
 * at boot when running in-memory mode.
 *
 * WebSocket connection bookkeeping remains in-process (a socket is
 * pinned to the pod that accepted it) and lives in the separate
 * `ConnectionRegistry` adapter. Cross-pod fanout via Redis pub/sub is
 * a follow-up.
 */

import { v4 as uuidv4 } from 'uuid';
import type { TenantId, NotificationTemplateId, SupportedLocale } from '../types/index.js';
import { resolveTemplate } from '../templates/index.js';
import { createLogger } from '../logger.js';
import type {
  InAppNotificationStore,
  ConnectionRegistry,
} from '../storage/types.js';
import {
  createInAppNotificationStore,
  createConnectionRegistry,
} from '../storage/factory.js';

const logger = createLogger('in-app-notification-service');

// ============================================================================
// Types
// ============================================================================

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationCategory =
  | 'payment'
  | 'maintenance'
  | 'lease'
  | 'announcement'
  | 'system'
  | 'reminder'
  | 'alert'
  | 'communication';

export interface InAppNotification {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly title: string;
  readonly message: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly actionUrl?: string;
  readonly actionLabel?: string;
  readonly metadata?: Record<string, unknown>;
  readonly templateId?: NotificationTemplateId;
  readonly isRead: boolean;
  readonly readAt?: string;
  readonly isArchived: boolean;
  readonly archivedAt?: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
}

export interface CreateInAppNotificationInput {
  tenantId: TenantId;
  userId: string;
  title: string;
  message: string;
  category: NotificationCategory;
  priority?: NotificationPriority;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
  templateId?: NotificationTemplateId;
  expiresAt?: Date;
}

export interface CreateFromTemplateInput {
  tenantId: TenantId;
  userId: string;
  templateId: NotificationTemplateId;
  data: Record<string, string>;
  category: NotificationCategory;
  priority?: NotificationPriority;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
  locale?: SupportedLocale;
  expiresAt?: Date;
}

export interface NotificationFilters {
  category?: NotificationCategory;
  priority?: NotificationPriority;
  isRead?: boolean;
  isArchived?: boolean;
  fromDate?: Date;
  toDate?: Date;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byCategory: Record<NotificationCategory, number>;
  byPriority: Record<NotificationPriority, number>;
}

export interface WebSocketConnection {
  userId: string;
  tenantId: TenantId;
  connectionId: string;
  send: (data: unknown) => void;
  isAlive: boolean;
}

// ============================================================================
// Service factory
// ============================================================================

export interface InAppNotificationServiceDeps {
  store?: InAppNotificationStore;
  connections?: ConnectionRegistry;
}

export interface InAppNotificationService {
  create(input: CreateInAppNotificationInput): Promise<InAppNotification>;
  createFromTemplate(input: CreateFromTemplateInput): Promise<InAppNotification>;
  broadcast(
    tenantId: TenantId,
    userIds: string[],
    input: Omit<CreateInAppNotificationInput, 'tenantId' | 'userId'>
  ): Promise<{ sent: number; failed: number }>;
  getById(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null>;
  listForUser(
    tenantId: TenantId,
    userId: string,
    filters?: NotificationFilters,
    limit?: number,
    offset?: number
  ): Promise<{ notifications: InAppNotification[]; total: number }>;
  getStats(tenantId: TenantId, userId: string): Promise<NotificationStats>;
  markAsRead(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null>;
  markAllAsRead(tenantId: TenantId, userId: string): Promise<number>;
  archive(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null>;
  delete(id: string, tenantId: TenantId, userId: string): Promise<boolean>;
  cleanupExpired(tenantIds?: readonly string[]): Promise<number>;
  registerConnection(connection: WebSocketConnection): void;
  unregisterConnection(connectionId: string): void;
  pushToUser(
    tenantId: TenantId,
    userId: string,
    notification: InAppNotification
  ): void;
  getUnreadCount(tenantId: TenantId, userId: string): Promise<number>;
  createAnnouncement(
    tenantId: TenantId,
    title: string,
    message: string,
    userIdsOrResolver:
      | readonly string[]
      | ((tenantId: TenantId) => Promise<readonly string[]> | readonly string[]),
    options?: {
      priority?: NotificationPriority;
      actionUrl?: string;
      actionLabel?: string;
      expiresAt?: Date;
    }
  ): Promise<{ sent: number; failed: number }>;
  listAnnouncementsForTenant(
    tenantId: TenantId
  ): Promise<InAppNotification[]>;
}

export function createInAppNotificationService(
  deps: InAppNotificationServiceDeps = {}
): InAppNotificationService {
  const store: InAppNotificationStore = deps.store ?? createInAppNotificationStore();
  const connections: ConnectionRegistry =
    deps.connections ?? createConnectionRegistry();

  async function create(
    input: CreateInAppNotificationInput
  ): Promise<InAppNotification> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const expiresAt = input.expiresAt?.toISOString();
    const notification: InAppNotification = {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title,
      message: input.message,
      category: input.category,
      priority: input.priority ?? 'normal',
      ...(input.actionUrl !== undefined ? { actionUrl: input.actionUrl } : {}),
      ...(input.actionLabel !== undefined ? { actionLabel: input.actionLabel } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
      isRead: false,
      isArchived: false,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      createdAt: now,
    };

    await store.insert(notification);

    // Push to active WebSocket connections (per-pod only)
    pushToUser(input.tenantId, input.userId, notification);

    logger.info('In-app notification created', {
      id,
      userId: input.userId,
      category: input.category,
    });

    return notification;
  }

  async function createFromTemplate(
    input: CreateFromTemplateInput
  ): Promise<InAppNotification> {
    const locale = input.locale ?? 'en';
    const { subject, body } = resolveTemplate(input.templateId, locale, input.data);

    return create({
      tenantId: input.tenantId,
      userId: input.userId,
      title: subject,
      message: body,
      category: input.category,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.actionUrl !== undefined ? { actionUrl: input.actionUrl } : {}),
      ...(input.actionLabel !== undefined ? { actionLabel: input.actionLabel } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      templateId: input.templateId,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    });
  }

  async function broadcast(
    tenantId: TenantId,
    userIds: string[],
    input: Omit<CreateInAppNotificationInput, 'tenantId' | 'userId'>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const userId of userIds) {
      try {
        await create({ ...input, tenantId, userId });
        sent++;
      } catch (error) {
        logger.error('Failed to send broadcast notification', {
          userId,
          error: String(error),
        });
        failed++;
      }
    }
    logger.info('Broadcast complete', { tenantId, sent, failed });
    return { sent, failed };
  }

  async function getById(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null> {
    const notification = await store.getById(id);
    if (!notification) return null;
    if (notification.tenantId !== tenantId || notification.userId !== userId) {
      return null;
    }
    return notification;
  }

  async function listForUser(
    tenantId: TenantId,
    userId: string,
    filters?: NotificationFilters,
    limit = 50,
    offset = 0
  ): Promise<{ notifications: InAppNotification[]; total: number }> {
    const ids = await store.listIdsForUser(String(tenantId), userId);
    let userNotifs = (await store.getMany(ids)).slice();

    if (filters) {
      if (filters.category) {
        userNotifs = userNotifs.filter((n) => n.category === filters.category);
      }
      if (filters.priority) {
        userNotifs = userNotifs.filter((n) => n.priority === filters.priority);
      }
      if (filters.isRead !== undefined) {
        userNotifs = userNotifs.filter((n) => n.isRead === filters.isRead);
      }
      if (filters.isArchived !== undefined) {
        userNotifs = userNotifs.filter((n) => n.isArchived === filters.isArchived);
      }
      if (filters.fromDate) {
        userNotifs = userNotifs.filter(
          (n) => new Date(n.createdAt) >= filters.fromDate!
        );
      }
      if (filters.toDate) {
        userNotifs = userNotifs.filter(
          (n) => new Date(n.createdAt) <= filters.toDate!
        );
      }
    }

    // Filter out expired notifications
    const now = new Date();
    userNotifs = userNotifs.filter((n) => !n.expiresAt || new Date(n.expiresAt) > now);

    // Sort by creation date (newest first), then by priority
    const priorityOrder: Record<NotificationPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    userNotifs.sort((a, b) => {
      // Unread first
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      // Then by priority
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      // Then by date
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = userNotifs.length;
    const paged = userNotifs.slice(offset, offset + limit);

    return { notifications: paged, total };
  }

  async function getStats(
    tenantId: TenantId,
    userId: string
  ): Promise<NotificationStats> {
    const { notifications: userNotifs } = await listForUser(
      tenantId,
      userId,
      { isArchived: false },
      1_000_000,
      0
    );

    const stats: NotificationStats = {
      total: userNotifs.length,
      unread: userNotifs.filter((n) => !n.isRead).length,
      byCategory: {
        payment: 0,
        maintenance: 0,
        lease: 0,
        announcement: 0,
        system: 0,
        reminder: 0,
        alert: 0,
        communication: 0,
      },
      byPriority: {
        low: 0,
        normal: 0,
        high: 0,
        urgent: 0,
      },
    };

    for (const notif of userNotifs) {
      stats.byCategory[notif.category]++;
      stats.byPriority[notif.priority]++;
    }

    return stats;
  }

  async function markAsRead(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null> {
    const notification = await getById(id, tenantId, userId);
    if (!notification) return null;
    const updated: InAppNotification = {
      ...notification,
      isRead: true,
      readAt: new Date().toISOString(),
    };
    await store.replace(updated);
    logger.debug('Notification marked as read', { id });
    return updated;
  }

  /**
   * Mark all notifications as read.
   * Round-3 audit H10 fix: the previous implementation called
   * `listForUser` with `limit: 1000` and silently left the 1001st
   * onwards unread. Now we walk the user's notification-id index
   * directly so every unread row is updated regardless of count.
   */
  async function markAllAsRead(
    tenantId: TenantId,
    userId: string
  ): Promise<number> {
    const ids = await store.listIdsForUser(String(tenantId), userId);
    if (ids.length === 0) return 0;
    const rows = await store.getMany(ids);
    const nowIso = new Date().toISOString();
    let count = 0;
    for (const row of rows) {
      if (row.isRead) continue;
      await store.replace({ ...row, isRead: true, readAt: nowIso });
      count++;
    }
    logger.info('All notifications marked as read', { userId, count });
    return count;
  }

  async function archive(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<InAppNotification | null> {
    const notification = await getById(id, tenantId, userId);
    if (!notification) return null;
    const updated: InAppNotification = {
      ...notification,
      isArchived: true,
      archivedAt: new Date().toISOString(),
    };
    await store.replace(updated);
    logger.debug('Notification archived', { id });
    return updated;
  }

  async function remove(
    id: string,
    tenantId: TenantId,
    userId: string
  ): Promise<boolean> {
    const notification = await getById(id, tenantId, userId);
    if (!notification) return false;
    await store.remove(id);
    logger.debug('Notification deleted', { id });
    return true;
  }

  /**
   * Cleanup expired notifications.
   *
   * Round-3 audit H7 — the previous implementation iterated the
   * module-scoped `notifications` Map, racing across pods. The
   * adapter-backed implementation accepts an optional list of tenants
   * to sweep; when none is provided, it walks the in-memory index if
   * available. For the Redis adapter, callers are expected to run a
   * separate cron worker that knows the active tenant set (added in a
   * follow-up). Returning a count keeps the existing contract.
   */
  async function cleanupExpired(tenantIds?: readonly string[]): Promise<number> {
    const now = new Date();
    let cleaned = 0;
    // Best effort: if the caller did NOT supply tenants, try to walk
    // the in-memory store's tenant index by introspecting the adapter.
    // The introspection is duck-typed so the Redis adapter (which
    // doesn't expose tenant enumeration today) is a no-op rather than
    // a crash. This preserves the OLD in-memory behaviour 1:1 while
    // making the Redis path explicit about its limitation.
    const tenantsToSweep: readonly string[] | null = tenantIds
      ? tenantIds
      : 'listTenants' in store && typeof (store as unknown as { listTenants?: () => string[] }).listTenants === 'function'
        ? (store as unknown as { listTenants: () => string[] }).listTenants()
        : null;
    if (!tenantsToSweep) return cleaned;
    for (const t of tenantsToSweep) {
      const ids = await store.listIdsForTenant(t);
      const rows = await store.getMany(ids);
      for (const row of rows) {
        if (row.expiresAt && new Date(row.expiresAt) <= now) {
          await store.remove(row.id);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      logger.info('Cleaned up expired notifications', { count: cleaned });
    }
    return cleaned;
  }

  // ============================================================================
  // WebSocket / Real-time Support
  // ============================================================================

  function registerConnection(connection: WebSocketConnection): void {
    connections.register(connection);
    logger.debug('WebSocket connection registered', {
      connectionId: connection.connectionId,
      userId: connection.userId,
    });
  }

  function unregisterConnection(connectionId: string): void {
    connections.unregister(connectionId);
    logger.debug('WebSocket connection unregistered', { connectionId });
  }

  /**
   * Push notification to user's active connections.
   * Round-3 audit H22 fix — O(K) lookup by userKey instead of O(N)
   * scan over every connection in the pod.
   */
  function pushToUser(
    tenantId: TenantId,
    userId: string,
    notification: InAppNotification
  ): void {
    const connectionIds = connections.listConnectionIdsForUser(
      String(tenantId),
      userId
    );
    if (connectionIds.length === 0) return;
    for (const cid of connectionIds) {
      const connection = connections.getConnection(cid);
      if (!connection || !connection.isAlive) continue;
      try {
        connection.send({
          type: 'notification',
          data: notification,
        });
        logger.debug('Pushed notification to WebSocket', {
          connectionId: connection.connectionId,
          notificationId: notification.id,
        });
      } catch (error) {
        logger.warn('Failed to push notification to WebSocket', {
          connectionId: connection.connectionId,
          error: String(error),
        });
      }
    }
  }

  async function getUnreadCount(
    tenantId: TenantId,
    userId: string
  ): Promise<number> {
    const stats = await getStats(tenantId, userId);
    return stats.unread;
  }

  /**
   * Round-3 audit C5 fix — create system announcement.
   *
   * The previous implementation wrote a single row with the literal
   * sentinel `userId: '*'`, BUT `listForUser` filters strictly by the
   * key `${tenantId}:${userId}`. The `*` sentinel never matched, so
   * every announcement created via this path was unreadable to any
   * user. The new contract requires the caller to pass the resolved
   * `userIds` array (or a resolver). The function fans out by
   * delegating to `broadcast()` which writes a per-user row.
   */
  async function createAnnouncement(
    tenantId: TenantId,
    title: string,
    message: string,
    userIdsOrResolver:
      | readonly string[]
      | ((tenantId: TenantId) => Promise<readonly string[]> | readonly string[]),
    options: {
      priority?: NotificationPriority;
      actionUrl?: string;
      actionLabel?: string;
      expiresAt?: Date;
    } = {}
  ): Promise<{ sent: number; failed: number }> {
    const userIds = Array.isArray(userIdsOrResolver)
      ? [...userIdsOrResolver]
      : [
          ...(await (userIdsOrResolver as (
            t: TenantId
          ) => Promise<readonly string[]> | readonly string[])(tenantId)),
        ];

    if (userIds.length === 0) {
      logger.warn('createAnnouncement called with empty user list — no rows written', {
        tenantId,
        title,
      });
      return { sent: 0, failed: 0 };
    }

    return broadcast(tenantId, userIds, {
      title,
      message,
      category: 'announcement',
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.actionUrl !== undefined ? { actionUrl: options.actionUrl } : {}),
      ...(options.actionLabel !== undefined ? { actionLabel: options.actionLabel } : {}),
      ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
    });
  }

  async function listAnnouncementsForTenant(
    tenantId: TenantId
  ): Promise<InAppNotification[]> {
    const ids = await store.listIdsForTenant(String(tenantId));
    const rows = await store.getMany(ids);
    return rows.filter((n) => n.userId === '' && n.category === 'announcement');
  }

  return {
    create,
    createFromTemplate,
    broadcast,
    getById,
    listForUser,
    getStats,
    markAsRead,
    markAllAsRead,
    archive,
    delete: remove,
    cleanupExpired,
    registerConnection,
    unregisterConnection,
    pushToUser,
    getUnreadCount,
    createAnnouncement,
    listAnnouncementsForTenant,
  };
}

/**
 * Default service singleton. Existing callers (the index re-export
 * + the cleanup setInterval below) keep working unchanged.
 */
export const inAppNotificationService: InAppNotificationService =
  createInAppNotificationService();

// ============================================================================
// Cleanup Job (run periodically)
// ============================================================================

// Run cleanup every hour. The cleanup itself is a no-op until the
// Redis SCAN-based sweep is added in a follow-up — the legacy
// per-pod cleanup that raced across pods has been removed.
// In production, attach a Redis-backed cron-style worker that lists
// expired rows via TTL or SCAN; see `../storage/redis.ts`.
if (process.env['NODE_ENV'] !== 'test') {
  setInterval(() => {
    void inAppNotificationService.cleanupExpired();
  }, 60 * 60 * 1000);
}
