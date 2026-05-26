/**
 * @borjie/data-protection — public entrypoint.
 *
 * Universal-from-day-one: no jurisdiction, framework, or country code
 * is named in this package's runtime code. The package consumes a
 * `ComplianceFrameworkPort` supplied by the caller via the
 * frameworks helpers exported here. See
 * Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md.
 */

export * from './types.js';
export * from './classify/auto-tagger.js';
export * from './encrypt/aead-cipher.js';
export * from './encrypt/key-manager.js';
export * from './encrypt/envelope.js';
export * from './encrypt/rotation.js';
export * from './retention/retention-runner.js';
export * from './rtbf/cascade-planner.js';
export * from './rtbf/rtbf-orchestrator.js';
export * from './breach/breach-detector.js';
export * from './breach/breach-notifier.js';
export * from './lineage/provenance-tracker.js';
export * from './frameworks/index.js';
