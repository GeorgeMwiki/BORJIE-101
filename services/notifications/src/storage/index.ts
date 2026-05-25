/**
 * Storage adapters for the notifications service.
 *
 * Round-3 audit H6 + H7 — see `./types.ts` for the contract and
 * rationale. `./factory.ts` is the entry-point most callers want;
 * the in-memory + Redis adapter classes are exported so tests can
 * construct them directly.
 */

export type {
  PreferencesStore,
  InAppNotificationStore,
  ConnectionRegistry,
} from './types.js';

export {
  InMemoryPreferencesStore,
  InMemoryInAppNotificationStore,
  InMemoryConnectionRegistry,
} from './in-memory.js';

export {
  RedisPreferencesStore,
  RedisInAppNotificationStore,
} from './redis.js';

export {
  createPreferencesStore,
  createInAppNotificationStore,
  createConnectionRegistry,
  getSharedRedisClient,
  resetStorageForTests,
  type CreateStorageOptions,
} from './factory.js';
