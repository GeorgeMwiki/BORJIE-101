/**
 * Equipment-maintenance-taxonomy module — Borjie mining.
 *
 * Replaces the property-domain `maintenance-taxonomy/maintenance-
 * taxonomy-service.ts` with a mining-domain equivalent keyed on
 * `assets.kind` (excavator|compressor|drill_rig|...). Platform
 * defaults (tenantId NULL) merge with per-tenant overrides.
 */

export * from './types.js';
export * from './drizzle-equipment-maintenance-taxonomy-repository.js';
