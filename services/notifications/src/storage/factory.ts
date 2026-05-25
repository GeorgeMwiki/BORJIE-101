/**
 * Storage adapter factory.
 *
 * Reads `REDIS_URL` from the environment. If set, returns Redis-backed
 * adapters. Otherwise returns in-memory adapters AND emits a
 * `store-not-durable` warn so the gap is observable in production logs.
 *
 * Round-3 audit H6 + H7 — see `./types.ts` header.
 */

import { Redis } from 'ioredis';
import { createLogger } from '../logger.js';
import {
  InMemoryPreferencesStore,
  InMemoryInAppNotificationStore,
  InMemoryConnectionRegistry,
} from './in-memory.js';
import {
  RedisPreferencesStore,
  RedisInAppNotificationStore,
} from './redis.js';
import type {
  PreferencesStore,
  InAppNotificationStore,
  ConnectionRegistry,
} from './types.js';

const logger = createLogger('notifications-storage');

let cachedRedisClient: Redis | null = null;
let cachedPreferencesStore: PreferencesStore | null = null;
let cachedInAppStore: InAppNotificationStore | null = null;
let cachedConnectionRegistry: ConnectionRegistry | null = null;

/**
 * Lazily construct (and cache) the shared ioredis client used by every
 * adapter. The lazy approach means a process that never imports this
 * factory does NOT open a Redis connection.
 *
 * The named `Redis` export is the constructor (the default export is
 * the same symbol but TypeScript's `module: NodeNext` / esModuleInterop
 * pair does NOT expose construct signatures on the default-as-namespace
 * shape — using the named export sidesteps `TS2351`).
 *
 * Visible for tests so they can inject a mock client; not exported
 * from the package barrel.
 */
export function getSharedRedisClient(url?: string): Redis | null {
  if (cachedRedisClient) return cachedRedisClient;
  const resolved = url ?? process.env['REDIS_URL'];
  if (!resolved) return null;
  const client = new Redis(resolved, {
    // Notifications storage MUST tolerate transient Redis outages
    // without crashing the pod — the dispatcher is the place to fail.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err) => {
    logger.error('Redis client error', { error: String(err) });
  });
  cachedRedisClient = client;
  return client;
}

/**
 * Reset the cached adapters. Test-only — production callers MUST treat
 * the stores as singletons.
 */
export function resetStorageForTests(): void {
  cachedRedisClient = null;
  cachedPreferencesStore = null;
  cachedInAppStore = null;
  cachedConnectionRegistry = null;
}

export interface CreateStorageOptions {
  /**
   * Override the Redis URL. Defaults to `process.env.REDIS_URL`. Pass
   * `null` to force in-memory mode (used by tests).
   */
  redisUrl?: string | null;
  /**
   * Test-only — inject a pre-built Redis client (e.g. ioredis-mock).
   * When provided, `redisUrl` is ignored.
   */
  client?: Redis;
}

function warnIfInMemory(reason: string): void {
  logger.warn('store-not-durable', {
    reason,
    impact:
      'Notification preferences + in-app rows are held in process memory. ' +
      'Multi-pod deployments will see inconsistent state and pod restarts ' +
      'will lose data. Set REDIS_URL to enable durable storage.',
  });
}

export function createPreferencesStore(
  options: CreateStorageOptions = {}
): PreferencesStore {
  if (cachedPreferencesStore && options.redisUrl === undefined && !options.client) {
    return cachedPreferencesStore;
  }
  if (options.client) {
    const store = new RedisPreferencesStore(options.client);
    if (!cachedPreferencesStore) cachedPreferencesStore = store;
    return store;
  }
  if (options.redisUrl === null) {
    warnIfInMemory('explicit null redisUrl');
    const store = new InMemoryPreferencesStore();
    if (!cachedPreferencesStore) cachedPreferencesStore = store;
    return store;
  }
  const client = getSharedRedisClient(options.redisUrl);
  if (!client) {
    warnIfInMemory('REDIS_URL unset');
    const store = new InMemoryPreferencesStore();
    if (!cachedPreferencesStore) cachedPreferencesStore = store;
    return store;
  }
  const store = new RedisPreferencesStore(client);
  cachedPreferencesStore = store;
  return store;
}

export function createInAppNotificationStore(
  options: CreateStorageOptions = {}
): InAppNotificationStore {
  if (cachedInAppStore && options.redisUrl === undefined && !options.client) {
    return cachedInAppStore;
  }
  if (options.client) {
    const store = new RedisInAppNotificationStore(options.client);
    if (!cachedInAppStore) cachedInAppStore = store;
    return store;
  }
  if (options.redisUrl === null) {
    // The preferences factory already warned; do not duplicate.
    const store = new InMemoryInAppNotificationStore();
    if (!cachedInAppStore) cachedInAppStore = store;
    return store;
  }
  const client = getSharedRedisClient(options.redisUrl);
  if (!client) {
    const store = new InMemoryInAppNotificationStore();
    if (!cachedInAppStore) cachedInAppStore = store;
    return store;
  }
  const store = new RedisInAppNotificationStore(client);
  cachedInAppStore = store;
  return store;
}

export function createConnectionRegistry(): ConnectionRegistry {
  // Connections are always per-pod (a socket is pinned to the pod that
  // accepted it). Redis pub/sub for cross-pod fanout is a follow-up.
  if (cachedConnectionRegistry) return cachedConnectionRegistry;
  cachedConnectionRegistry = new InMemoryConnectionRegistry();
  return cachedConnectionRegistry;
}
