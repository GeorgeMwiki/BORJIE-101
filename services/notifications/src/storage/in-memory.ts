/**
 * In-memory adapters for the storage interfaces.
 *
 * Extracted verbatim from the previous module-scoped Maps in
 * `preferences/service.ts` and `services/in-app-notification.service.ts`.
 * Behaviour is identical so that existing single-pod deployments keep
 * working without ANY configuration change. Multi-pod deployments
 * MUST flip on the Redis adapter by setting `REDIS_URL`.
 *
 * Round-3 audit H6 + H7 — see `./types.ts` header for the full
 * rationale.
 */

import type {
  NotificationPreferences,
} from '../preferences/types.js';
import type {
  InAppNotification,
  WebSocketConnection,
} from '../services/in-app-notification.service.js';
import type {
  PreferencesStore,
  InAppNotificationStore,
  ConnectionRegistry,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prefKey(userId: string, tenantId: string): string {
  return `${tenantId}:${userId}`;
}

function userKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

// ---------------------------------------------------------------------------
// In-memory PreferencesStore
// ---------------------------------------------------------------------------

export class InMemoryPreferencesStore implements PreferencesStore {
  private readonly store = new Map<string, NotificationPreferences>();

  async get(
    userId: string,
    tenantId: string
  ): Promise<NotificationPreferences | null> {
    const existing = this.store.get(prefKey(userId, tenantId));
    return existing ?? null;
  }

  async set(prefs: NotificationPreferences): Promise<void> {
    this.store.set(prefKey(prefs.userId, prefs.tenantId), prefs);
  }

  async update(
    userId: string,
    tenantId: string,
    apply: (existing: NotificationPreferences | null) => NotificationPreferences
  ): Promise<NotificationPreferences> {
    const existing = this.store.get(prefKey(userId, tenantId)) ?? null;
    const next = apply(existing);
    this.store.set(prefKey(userId, tenantId), next);
    return next;
  }

  async delete(userId: string, tenantId: string): Promise<boolean> {
    return this.store.delete(prefKey(userId, tenantId));
  }

  /** Test helper — not part of the interface. */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// In-memory InAppNotificationStore
// ---------------------------------------------------------------------------

export class InMemoryInAppNotificationStore implements InAppNotificationStore {
  private readonly notifications = new Map<string, InAppNotification>();
  private readonly userIndex = new Map<string, Set<string>>();
  private readonly tenantIndex = new Map<string, Set<string>>();

  async insert(notification: InAppNotification): Promise<void> {
    this.notifications.set(notification.id, notification);
    const uKey = userKey(String(notification.tenantId), notification.userId);
    let uset = this.userIndex.get(uKey);
    if (!uset) {
      uset = new Set();
      this.userIndex.set(uKey, uset);
    }
    uset.add(notification.id);
    const tKey = String(notification.tenantId);
    let tset = this.tenantIndex.get(tKey);
    if (!tset) {
      tset = new Set();
      this.tenantIndex.set(tKey, tset);
    }
    tset.add(notification.id);
  }

  async getById(id: string): Promise<InAppNotification | null> {
    return this.notifications.get(id) ?? null;
  }

  async replace(notification: InAppNotification): Promise<boolean> {
    if (!this.notifications.has(notification.id)) return false;
    this.notifications.set(notification.id, notification);
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const existing = this.notifications.get(id);
    if (!existing) return false;
    this.notifications.delete(id);
    this.userIndex
      .get(userKey(String(existing.tenantId), existing.userId))
      ?.delete(id);
    this.tenantIndex.get(String(existing.tenantId))?.delete(id);
    return true;
  }

  async listIdsForUser(
    tenantId: string,
    userId: string
  ): Promise<readonly string[]> {
    const set = this.userIndex.get(userKey(tenantId, userId));
    return set ? Array.from(set) : [];
  }

  async listIdsForTenant(tenantId: string): Promise<readonly string[]> {
    const set = this.tenantIndex.get(tenantId);
    return set ? Array.from(set) : [];
  }

  async getMany(ids: readonly string[]): Promise<readonly InAppNotification[]> {
    const out: InAppNotification[] = [];
    for (const id of ids) {
      const row = this.notifications.get(id);
      if (row) out.push(row);
    }
    return out;
  }

  /**
   * Best-effort tenant enumeration for the per-pod cleanup loop. Not
   * part of the interface — the cleanup code duck-types this method
   * so the Redis adapter (which would need a SCAN-based sweep) opts
   * out cleanly instead of crashing.
   */
  listTenants(): string[] {
    return Array.from(this.tenantIndex.keys());
  }

  /** Test helper — not part of the interface. */
  clear(): void {
    this.notifications.clear();
    this.userIndex.clear();
    this.tenantIndex.clear();
  }
}

// ---------------------------------------------------------------------------
// In-memory ConnectionRegistry
// ---------------------------------------------------------------------------

export class InMemoryConnectionRegistry implements ConnectionRegistry {
  private readonly activeConnections = new Map<string, WebSocketConnection>();
  private readonly byUser = new Map<string, Set<string>>();

  register(connection: WebSocketConnection): void {
    this.activeConnections.set(connection.connectionId, connection);
    const uKey = userKey(String(connection.tenantId), connection.userId);
    let set = this.byUser.get(uKey);
    if (!set) {
      set = new Set();
      this.byUser.set(uKey, set);
    }
    set.add(connection.connectionId);
  }

  unregister(connectionId: string): void {
    const conn = this.activeConnections.get(connectionId);
    this.activeConnections.delete(connectionId);
    if (conn) {
      const uKey = userKey(String(conn.tenantId), conn.userId);
      const set = this.byUser.get(uKey);
      if (set) {
        set.delete(connectionId);
        if (set.size === 0) this.byUser.delete(uKey);
      }
    }
  }

  listConnectionIdsForUser(
    tenantId: string,
    userId: string
  ): readonly string[] {
    const set = this.byUser.get(userKey(tenantId, userId));
    return set ? Array.from(set) : [];
  }

  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.activeConnections.get(connectionId);
  }

  clear(): void {
    this.activeConnections.clear();
    this.byUser.clear();
  }
}
