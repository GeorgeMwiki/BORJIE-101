/**
 * `@borjie/brain-llm-router/concurrency-gate` — public surface.
 */

export {
  SlotAcquireTimeoutError,
  acquireSlot,
  createConcurrencyGate,
  getDefaultTenantCapacity,
  getDefaultGlobalCapacity,
  resetConcurrencyGate,
  type AcquireOptions,
  type ConcurrencyGate,
  type SlotRelease,
} from './concurrency-gate.js';

// LP-10 — shared-store (Redis/Upstash) backend for multi-replica capacity.
export {
  InMemoryConcurrencyStore,
  type ConcurrencyStore,
} from './store-port.js';

export {
  UpstashConcurrencyStore,
  ACQUIRE_LUA,
  RELEASE_LUA,
  type RedisEvalPort,
  type UpstashStoreLogger,
  type UpstashStoreOptions,
} from './upstash-store.js';

export {
  createStoreBackedGate,
  type StoreBackedGateOptions,
} from './store-backed-gate.js';
