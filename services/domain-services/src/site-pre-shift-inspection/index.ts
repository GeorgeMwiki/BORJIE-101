/**
 * Site pre-shift inspection module — Borjie mining.
 *
 * Replaces the property-domain `inspections/conditional-survey` postgres
 * repository with a mining-specific pre-shift safety checklist keyed
 * per drill rig / heavy asset per shift.
 */

export * from './types.js';
export * from './postgres-site-pre-shift-inspection-repository.js';
