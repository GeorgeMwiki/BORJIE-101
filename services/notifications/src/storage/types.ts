/**
 * Storage adapter contracts for the notifications service.
 *
 * Round-3 audit H6 + H7 fix — `preferencesService` and
 * `inAppNotificationService` previously held all state in module-scoped
 * Maps. This meant:
 *   * every pod had its own copy of user opt-outs (one pod could send a
 *     notification the user had disabled on another pod);
 *   * a pod restart erased every in-app notification (the badge would
 *     suddenly drop to zero for half the platform);
 *   * the cleanup job (`setInterval(60 min)`) raced across pods with
 *     no shared view of which rows had already expired.
 *
 * The fix is to wrap the stores behind small interfaces so a real
 * datastore can be swapped in. To avoid forcing operators to wire
 * Redis the moment they pull this code, the factory defaults to the
 * existing in-memory behaviour when `REDIS_URL` is unset AND emits a
 * `store-not-durable` warn at boot so the gap is observable.
 *
 * The interfaces below expose ONLY the operations the existing services
 * actually call — there is no speculative "supports queries" or
 * "supports transactions" surface. When a new operation is needed it is
 * added here first and then to every adapter.
 */

import type {
  NotificationPreferences,
  UpdatePreferencesInput,
} from '../preferences/types.js';
import type {
  InAppNotification,
  WebSocketConnection,
} from '../services/in-app-notification.service.js';

// ---------------------------------------------------------------------------
// Preferences store
// ---------------------------------------------------------------------------

/**
 * Persistence contract for `preferencesService`. Every method is async
 * because the Redis-backed adapter needs to await a network call; the
 * in-memory adapter resolves synchronously but exposes the same shape
 * so callers do not branch on adapter identity.
 *
 * Keys are composed by the caller (`${tenantId}:${userId}`) — the
 * adapter is intentionally key-opaque so a future SQL-backed store can
 * compose the primary key however its schema demands.
 */
export interface PreferencesStore {
  /**
   * Return the full preference record for a user. Returns null when no
   * preference has been saved (the calling service applies defaults).
   */
  get(userId: string, tenantId: string): Promise<NotificationPreferences | null>;

  /**
   * Replace the stored preference record. Idempotent — passing the same
   * payload twice is safe.
   */
  set(prefs: NotificationPreferences): Promise<void>;

  /**
   * Apply a partial update. Adapter MUST read-modify-write atomically
   * (Redis adapter uses WATCH/MULTI; in-memory simply replaces).
   */
  update(
    userId: string,
    tenantId: string,
    apply: (existing: NotificationPreferences | null) => NotificationPreferences
  ): Promise<NotificationPreferences>;

  /**
   * Remove a preference record. Returns true if the record existed.
   * Intended for GDPR delete and tests.
   */
  delete(userId: string, tenantId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// In-app notification store
// ---------------------------------------------------------------------------

/**
 * Persistence contract for `inAppNotificationService`. Mirrors the
 * three module-scoped Maps that previously held state in the service:
 *   * `notifications` (id -> row)
 *   * `userNotifications` (`${tenantId}:${userId}` -> Set<id>)
 *   * `tenantNotifications` (`${tenantId}` -> Set<id>)
 *
 * `activeConnections` + `connectionsByUser` are deliberately NOT in
 * this interface — they are per-pod ephemeral state (a WebSocket is
 * pinned to the pod that owns it). Sharing them across pods requires a
 * pub/sub layer, which is out of scope for this fix.
 */
export interface InAppNotificationStore {
  /**
   * Persist a new notification row + update both indices in a single
   * adapter call. Atomic per adapter (in-memory is naturally atomic;
   * Redis uses MULTI/EXEC).
   */
  insert(notification: InAppNotification): Promise<void>;

  /**
   * Look up a single notification by id. Returns null if absent.
   * The caller verifies tenant + user ownership.
   */
  getById(id: string): Promise<InAppNotification | null>;

  /**
   * Replace an existing notification row (used by `markAsRead`,
   * `archive`, `markAllAsRead`). Returns true if the row existed.
   */
  replace(notification: InAppNotification): Promise<boolean>;

  /**
   * Remove a notification row + its index entries. Returns true if the
   * row existed.
   */
  remove(id: string): Promise<boolean>;

  /**
   * Return the list of notification ids known for a user. Callers
   * iterate the ids and fetch each row — this matches the existing
   * service's access pattern and keeps the interface key-opaque.
   *
   * The adapter MAY return the ids in insertion order; callers MUST
   * sort by the row's `createdAt` if they care about ordering.
   */
  listIdsForUser(tenantId: string, userId: string): Promise<readonly string[]>;

  /**
   * Return the list of notification ids known for a tenant. Used by
   * the cleanup job and `listAnnouncementsForTenant`.
   */
  listIdsForTenant(tenantId: string): Promise<readonly string[]>;

  /**
   * Bulk fetch (used by the cleanup loop). The adapter MAY use a
   * pipeline. Missing ids are silently omitted from the result.
   */
  getMany(ids: readonly string[]): Promise<readonly InAppNotification[]>;
}

// ---------------------------------------------------------------------------
// WebSocket connection registry
// ---------------------------------------------------------------------------

/**
 * Per-pod WebSocket connection bookkeeping. Kept on this side of the
 * abstraction even though it is NEVER persisted, because the existing
 * service co-locates connection state with notification state and
 * splitting it out would force a larger refactor. The adapter is
 * `InMemoryOnly` by design — Redis pub/sub for cross-pod fanout is a
 * follow-up.
 */
export interface ConnectionRegistry {
  register(connection: WebSocketConnection): void;
  unregister(connectionId: string): void;
  listConnectionIdsForUser(tenantId: string, userId: string): readonly string[];
  getConnection(connectionId: string): WebSocketConnection | undefined;
  clear(): void;
}
