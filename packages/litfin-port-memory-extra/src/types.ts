/**
 * Shared types for litfin-port-memory-extra patterns.
 *
 * All identifiers are branded to prevent cross-type leakage. All
 * structures are immutable (`readonly`); helpers create new objects
 * rather than mutating inputs.
 */

export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type FactId = string & { readonly __brand: 'FactId' };
export type EntityId = string & { readonly __brand: 'EntityId' };
export type AnswerCacheKey = string & { readonly __brand: 'AnswerCacheKey' };

export interface MemoryClock {
  readonly now: () => number; // epoch millis
}

export const DEFAULT_CLOCK: MemoryClock = { now: () => Date.now() };
