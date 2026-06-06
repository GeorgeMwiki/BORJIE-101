export * from './types.js';
export * from './far-service.js';
export * from './far-scheduler.js';
// Mining-domain Wave 5 — the property-domain `PostgresFarRepository`
// (asset_components / far_assignments / condition_check_events, all
// dropped by migration 0003) has been removed. The mining-equivalent
// `PostgresSiteFarRepository` (over `assets` + `maintenance_events`)
// lives under `@borjie/domain-services/site`.
//
// Mining FAR service (REAL, over `PostgresSiteFarRepository`). The
// `/far` route binds to `createMiningFarService` via the composition
// root. Exported here so it flows up through `export * as Inspections`
// → `Far` with zero symbol collisions against the legacy property
// `FarService` above.
export * from './mining-far-service.js';
export * from './mining-far-types.js';
