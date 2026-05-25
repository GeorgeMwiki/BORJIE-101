/**
 * Redis-backed adapters for the storage interfaces.
 *
 * Round-3 audit H6 + H7 fix — see `./types.ts` header. This file is
 * imported lazily from the factory so that environments WITHOUT
 * `REDIS_URL` set never construct a Redis client.
 *
 * Key layout (all keys are prefixed with `notif:` to stay clear of the
 * BullMQ queue keys that share the same Redis instance):
 *   * `notif:pref:{tenantId}:{userId}` — JSON blob of preferences
 *   * `notif:inapp:row:{id}`           — JSON blob of one notification
 *   * `notif:inapp:user:{tenantId}:{userId}` — SET of notification ids
 *   * `notif:inapp:tenant:{tenantId}`        — SET of notification ids
 *
 * Atomicity:
 *   * `update()` uses WATCH/MULTI/EXEC with retry on CAS conflict.
 *   * `insert()` uses MULTI/EXEC to write the row + both indices in
 *     one round-trip.
 *   * `remove()` reads the row first (to learn the user/tenant key for
 *     the indices) then MULTI/EXEC the delete + SREM pair.
 *
 * Encoding: `JSON.stringify` round-trips through `JSON.parse`. `Date`
 * fields (`updatedAt` on preferences) are normalised to ISO strings on
 * write and rehydrated on read.
 */

import type { Redis } from 'ioredis';
// Round-3 note: `Redis` is imported as type-only here. The runtime
// constructor lives in `./factory.ts`, which uses the named (not
// default) export so TypeScript's NodeNext interop exposes the
// construct signatures. See factory.ts header for the rationale.
import type {
  NotificationPreferences,
} from '../preferences/types.js';
import type {
  InAppNotification,
} from '../services/in-app-notification.service.js';
import type {
  PreferencesStore,
  InAppNotificationStore,
} from './types.js';

const KEY_PREFIX = 'notif:';
const MAX_UPDATE_RETRIES = 5;

function prefKey(userId: string, tenantId: string): string {
  return `${KEY_PREFIX}pref:${tenantId}:${userId}`;
}

function inAppRowKey(id: string): string {
  return `${KEY_PREFIX}inapp:row:${id}`;
}

function inAppUserKey(tenantId: string, userId: string): string {
  return `${KEY_PREFIX}inapp:user:${tenantId}:${userId}`;
}

function inAppTenantKey(tenantId: string): string {
  return `${KEY_PREFIX}inapp:tenant:${tenantId}`;
}

// ---------------------------------------------------------------------------
// Preferences serialisation
// ---------------------------------------------------------------------------

interface SerialisedPreferences extends Omit<NotificationPreferences, 'updatedAt'> {
  updatedAt: string;
}

function serialisePreferences(prefs: NotificationPreferences): string {
  const wire: SerialisedPreferences = {
    ...prefs,
    updatedAt: prefs.updatedAt.toISOString(),
  };
  return JSON.stringify(wire);
}

function deserialisePreferences(raw: string | null): NotificationPreferences | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as SerialisedPreferences;
  return {
    ...parsed,
    updatedAt: new Date(parsed.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// RedisPreferencesStore
// ---------------------------------------------------------------------------

export class RedisPreferencesStore implements PreferencesStore {
  constructor(private readonly client: Redis) {}

  async get(
    userId: string,
    tenantId: string
  ): Promise<NotificationPreferences | null> {
    const raw = await this.client.get(prefKey(userId, tenantId));
    return deserialisePreferences(raw);
  }

  async set(prefs: NotificationPreferences): Promise<void> {
    await this.client.set(
      prefKey(prefs.userId, prefs.tenantId),
      serialisePreferences(prefs)
    );
  }

  async update(
    userId: string,
    tenantId: string,
    apply: (existing: NotificationPreferences | null) => NotificationPreferences
  ): Promise<NotificationPreferences> {
    const key = prefKey(userId, tenantId);
    for (let attempt = 0; attempt < MAX_UPDATE_RETRIES; attempt++) {
      await this.client.watch(key);
      const raw = await this.client.get(key);
      const existing = deserialisePreferences(raw);
      const next = apply(existing);
      const result = await this.client
        .multi()
        .set(key, serialisePreferences(next))
        .exec();
      if (result !== null) {
        // EXEC succeeded — no concurrent writer beat us.
        return next;
      }
      // EXEC returned null — WATCH detected a write. Loop and retry.
    }
    throw new Error(
      `RedisPreferencesStore.update: lost CAS contention after ${MAX_UPDATE_RETRIES} retries for ${userId}/${tenantId}`
    );
  }

  async delete(userId: string, tenantId: string): Promise<boolean> {
    const removed = await this.client.del(prefKey(userId, tenantId));
    return removed > 0;
  }
}

// ---------------------------------------------------------------------------
// RedisInAppNotificationStore
// ---------------------------------------------------------------------------

export class RedisInAppNotificationStore implements InAppNotificationStore {
  constructor(private readonly client: Redis) {}

  async insert(notification: InAppNotification): Promise<void> {
    const tenantId = String(notification.tenantId);
    const userKey = inAppUserKey(tenantId, notification.userId);
    const tenantKey = inAppTenantKey(tenantId);
    await this.client
      .multi()
      .set(inAppRowKey(notification.id), JSON.stringify(notification))
      .sadd(userKey, notification.id)
      .sadd(tenantKey, notification.id)
      .exec();
  }

  async getById(id: string): Promise<InAppNotification | null> {
    const raw = await this.client.get(inAppRowKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as InAppNotification;
  }

  async replace(notification: InAppNotification): Promise<boolean> {
    // SET ... XX returns null when the key did NOT exist (we are not
    // creating it). 'OK' otherwise.
    const res = await this.client.set(
      inAppRowKey(notification.id),
      JSON.stringify(notification),
      'XX'
    );
    return res === 'OK';
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    const tenantId = String(existing.tenantId);
    await this.client
      .multi()
      .del(inAppRowKey(id))
      .srem(inAppUserKey(tenantId, existing.userId), id)
      .srem(inAppTenantKey(tenantId), id)
      .exec();
    return true;
  }

  async listIdsForUser(
    tenantId: string,
    userId: string
  ): Promise<readonly string[]> {
    const ids = await this.client.smembers(inAppUserKey(tenantId, userId));
    return ids;
  }

  async listIdsForTenant(tenantId: string): Promise<readonly string[]> {
    const ids = await this.client.smembers(inAppTenantKey(tenantId));
    return ids;
  }

  async getMany(ids: readonly string[]): Promise<readonly InAppNotification[]> {
    if (ids.length === 0) return [];
    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.get(inAppRowKey(id));
    }
    const results = await pipeline.exec();
    if (!results) return [];
    const out: InAppNotification[] = [];
    for (const [err, raw] of results) {
      if (err || !raw) continue;
      try {
        out.push(JSON.parse(raw as string) as InAppNotification);
      } catch {
        // Malformed row — skip silently rather than poison the whole list.
      }
    }
    return out;
  }
}
