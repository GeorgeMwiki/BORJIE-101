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
