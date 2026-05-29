/**
 * Negotiation domain service public API.
 *
 * Mining-domain Wave 5 — the property-domain
 * `postgres-negotiation-repository.ts` has been removed. The mining
 * `PostgresBidNegotiationRepository` (bid-thread offers / counters)
 * lives under `@borjie/domain-services/marketplace`.
 */
export * from './types.js';
export * from './policy-enforcement.js';
export * from './negotiation-service.js';
export * from './llm-counter-generator.js';
