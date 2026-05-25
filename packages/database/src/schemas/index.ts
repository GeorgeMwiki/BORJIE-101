/**
 * Schema exports for Borjie database.
 *
 * Re-exports every Drizzle table for the Borjie mining-domain platform.
 * Property-domain BossNyumba tables (buildings, units, leases, vendors,
 * tenant rentals, etc.) were removed in migration 0003_mining_domain.sql
 * — the surviving schemas cover the generic AI-OS infrastructure plus
 * the new mining-domain mining-specific tables.
 */

// ---------------------------------------------------------------------------
// Tenants + identity + audit
// ---------------------------------------------------------------------------
export * from './tenant.schema.js';
export * from './identity.schema.js';

// Audit-events module: tenant.schema also exports a legacy auditEvents
// table; expose the richer module via the `AuditEvents` namespace and
// re-export non-conflicting enums directly.
export {
  auditCategoryEnum,
  auditOutcomeEnum,
  auditSeverityEnum,
  auditActorTypeEnum,
  auditEventsRelations,
} from './audit-events.schema.js';
export * as AuditEvents from './audit-events.schema.js';

// ---------------------------------------------------------------------------
// Mining-domain core (Borjie)
// ---------------------------------------------------------------------------
export * from './companies.schema.js';
export * from './licences.schema.js';
export * from './sites.schema.js';
export * from './geology.schema.js';
export * from './workforce.schema.js';
export * from './assets-fleet.schema.js';
export * from './production-sales.schema.js';
export * from './treasury.schema.js';
export * from './safety-csr.schema.js';
export * from './marketplace.schema.js';
export * from './risks-tasks.schema.js';
export * from './fingerprint-events.schema.js';
export * from './intelligence-corpus.schema.js';

// ---------------------------------------------------------------------------
// AI-OS infra (generic)
// ---------------------------------------------------------------------------
export * from './documents.schema.js';
export * from './communications.schema.js';
export * from './outbox.schema.js';
export * from './conversation.schema.js';
export * from './conversation-capture.schema.js';

export * from './approval-policy.schema.js';
export * from './document-render-jobs.schema.js';
export * from './scan-bundles.schema.js';
export * from './document-embeddings.schema.js';
export * from './doc-chat-sessions.schema.js';
export * from './doc-chat-messages.schema.js';
export * from './migration-runs.schema.js';
export * from './geo.schema.js';

// Feature flags, GDPR, AI cost, webhook delivery
export * from './feature-flags.schema.js';
export * from './gdpr.schema.js';
export * from './ai-cost.schema.js';
export * from './webhook-delivery.schema.js';

// AI security + semantic memory
export * from './ai-audit-chain.schema.js';
export * from './ai-semantic-memory.schema.js';
export * from './training.schema.js';

// Intelligence + autonomy
export * from './ai-intelligence-feedback.schema.js';
export * from './progressive-context.schema.js';
export * from './autonomy.schema.js';
export * from './autonomy-caps.schema.js';

// Org awareness
export * from './org-awareness.schema.js';

// Brain kernel substrate + memory tiers
export * from './kernel-substrate.schema.js';
export * from './kernel-memory-episodic.schema.js';
export * from './kernel-memory-semantic.schema.js';
export * from './kernel-memory-procedural.schema.js';
export * from './kernel-memory-reflective.schema.js';
export * from './kernel-feedback.schema.js';
export * from './kernel-goals.schema.js';
export * from './kernel-action-audit.schema.js';
export * from './kernel-prompt-registry.schema.js';

// Sovereign approvals + action ledger
export * from './sovereign-approvals.schema.js';
export * from './sovereign-action-ledger.schema.js';

// Platform-level controls
export * from './platform-privacy-budget.schema.js';
export * from './platform-feature-flags.schema.js';
export * from './platform-killswitch-state.schema.js';
export * from './platform-announcements.schema.js';

// Currency + persona
export * from './currency-rates.schema.js';
export * from './currency-preferences.schema.js';
export * from './persona-branding.schema.js';
export * from './persona-registry.schema.js';

// Market data cache (external feeds)
export * from './market-data-cache.schema.js';

// Monthly close (financial period close)
export * from './monthly-close-runs.schema.js';

// Voice turns + sensor routing
export * from './voice-turns.schema.js';
export * from './sensor-call-log.schema.js';
export * from './sensor-catalog.schema.js';
export * from './sensorium-event-log.schema.js';
export * from './tenant-budget-envelopes.schema.js';
export * from './privacy-budget-ledger.schema.js';
export * from './task-sensor-routing.schema.js';

// Voyager skill registry + reflexion
export * from './skill-registry.schema.js';
export * from './reflexion-buffer.schema.js';
export * from './implicit-feedback-signals.schema.js';

// Agency executor checkpoints
export * from './agency-run-checkpoints.schema.js';
export * from './action-runtime.schema.js';

// Temporal entity graph
export * from './temporal-entity-graph.schema.js';

// Cross-schema relations (must come AFTER every table import so the
// referenced tables are already in scope when relations() runs).
export * from './relations.js';

// Session replay (rrweb)
export * from './session-replay-chunks.schema.js';

// Core memory blocks + consolidation
export * from './core-memory-blocks.schema.js';
export * from './consolidation-emissions.schema.js';

// MDR plan + owner skills
export * from './mdr-plan.schema.js';
export * from './owner-skills.schema.js';

// Portal layouts + WORM audit + lesson store + AOP registry
export * from './portal-layouts.schema.js';
export * from './worm-audit-log.schema.js';
export * from './lesson-store.schema.js';
export * from './aop-registry.schema.js';

// A2A task store
export * from './a2a-tasks.schema.js';

// Carbon-market book
export * from './carbon-market-book.schema.js';

// Persistent A-Mem memory layer
export * from './memory.schema.js';

// Adaptive layouts + user-action tracker
export * from './section-layouts.schema.js';
export * from './user-action-tracker.schema.js';

// Decision traces
export * from './decision-traces.schema.js';

// Module update proposals + tab subscriptions / event log
export * from './module-update-proposals.schema.js';
export * from './tab-subscriptions.schema.js';
export * from './tab-event-log.schema.js';

// Cross-tenant denials + field-encryption + semantic cache
export * from './cross-tenant-denials.schema.js';
export * from './field-encryption-audit.schema.js';
export * from './semantic-cache-log.schema.js';

// Tutoring skill pack + interactive reports + presentation themes
export * from './tutoring-skill-pack.schema.js';
export * from './interactive-reports.schema.js';
export * from './presentation-themes.schema.js';
export * from './report-templates.schema.js';

// Sub MD SLO
export * from './sub-md-slo.schema.js';

// Polymorphic core-entity + dynamic modules (sub-package barrels).
export * from './core-entity/index.js';
export * from './modules/index.js';
