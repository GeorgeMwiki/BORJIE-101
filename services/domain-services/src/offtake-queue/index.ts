/**
 * Offtake-queue module — Borjie mining.
 *
 * Replaces the property-domain `waitlist/postgres-waitlist-repository.ts`
 * with a mining-domain equivalent: buyers waiting for ore parcels of a
 * given mineral. Status moves forward only: waiting → matched →
 * fulfilled (or expired/cancelled).
 */

export * from './types.js';
export * from './postgres-offtake-queue-repository.js';
