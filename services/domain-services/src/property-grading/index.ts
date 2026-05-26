/**
 * Property-grading domain module.
 *
 * Mining-domain Wave 5 — the property-domain `DrizzleSnapshotRepository`
 * has been removed (property_grade_snapshots was dropped by migration
 * 0003). The mining-domain ore-grading repo
 * (`DrizzleOreGradingRepository`) lives under
 * `@borjie/domain-services/ore`. Ports + weights / metrics adapters
 * remain exported for slot-shape compatibility while the surrounding
 * service migration continues.
 */

export * from './ports.js';
export * from './drizzle-weights-repository.js';
export * from './live-metrics-source.js';
export * from './create-property-grading-service.js';
