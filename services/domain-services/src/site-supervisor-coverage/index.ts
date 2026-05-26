/**
 * Site-supervisor coverage module — Borjie mining.
 *
 * Replaces the property-domain `routing/postgres-station-master-
 * coverage-repository.ts` with a mining-domain equivalent: which
 * supervisor is responsible for which site during which shift, with
 * validity windows for handovers.
 */

export * from './types.js';
export * from './postgres-site-supervisor-coverage-repository.js';
