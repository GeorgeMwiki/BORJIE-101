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
export * from './marketplace-bids.schema.js';
export * from './risks-tasks.schema.js';
export * from './fingerprint-events.schema.js';
export * from './intelligence-corpus.schema.js';

// Mining-domain extensions (migration 0005)
export * from './buyer-extensions.schema.js';
export * from './bid-negotiations.schema.js';
export * from './ore-grade-snapshots.schema.js';
export * from './ore-stockpiles.schema.js';

// Mining-domain workforce + marketplace extensions (migration 0007)
export * from './mining-workforce-extensions.schema.js';

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
export * from './killswitch-authorities.schema.js';
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

// Piece E executive-brief action queue (migration 0013).
// Note: the Piece B `routing_rules` table is defined in
// `./modules/routing-rules.schema.js` (re-exported through
// `./modules/index.js` below). Its columns were updated to the
// `source_kind / target_kind / condition_jsonb / active` shape that
// matches migration 0013.
export * from './executive-brief-actions.schema.js';

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

// Admin internals (migration 0008): regulator pipeline / prompt promotions
// / compliance escalations. Platform-scope tables backing the Borjie HQ
// admin console (`apps/admin-web`).
export * from './admin-internals.schema.js';

// Polymorphic core-entity + dynamic modules (sub-package barrels).
export * from './core-entity/index.js';
export * from './modules/index.js';

// Junior agent outputs (migration 0011): decision_log, audit_log,
// licence_dormancy_scores, sample_batches, geology_scores, site_layouts,
// sic_events, hr_summaries, asset_status_snapshots, forecast_snapshots,
// fx_snapshots, sales_advice, buyer_kyc_records, compliance_verdicts,
// safety_snapshots, grievance_records, contract_remediation,
// generated_reports, notifications_outbox, metallurgy_recommendations,
// risk_snapshots, plus junior_* mirrors of formal-schema tables.
export * from './junior-outputs/index.js';

// ---------------------------------------------------------------------------
// Wave 17 — Master Brain autonomous loops + Anticipatory UX +
//           Deep Research + Document Composition
// ---------------------------------------------------------------------------
// Phase-2 substrate for Mr. Mwikila's 24/7 MD operating model. Backing
// migrations 0016 (autonomy loops), 0017 (anticipatory UX), 0018 (deep
// research), 0019 (document composition). See docs/DESIGN/*.md for the
// contracts these tables implement.
export * from './master-brain-briefings.schema.js';
export * from './anticipatory-ux.schema.js';
export * from './deep-research.schema.js';
export * from './document-composition.schema.js';

// ---------------------------------------------------------------------------
// Wave 18U — Data Onboarding (places owner-uploaded data where it belongs)
// ---------------------------------------------------------------------------
// Backing migration 0022 — two tenant-scoped tables tracking owner-
// initiated onboarding sessions (7-stage pipeline: discover → match →
// propose → persist → chain → enrich) and per-row provenance linking
// persisted rows back to source files.
// See Docs/DESIGN/DATA_ONBOARDING_SPEC.md.
export * from './data-onboarding.schema.js';

// ---------------------------------------------------------------------------
// Wave 18S — Mutation Authority (the WRITE side of universal MD power)
// ---------------------------------------------------------------------------
// Five tables backing migration 0023_mutation_authority.sql:
// mutation_recipes (global), mutation_proposals (tenant-scoped state
// machine), mutation_approvals (owner + second-authoriser),
// mutation_history (append-only result ledger),
// second_authoriser_assignments (per-tenant double-verify pairing).
// See docs/DESIGN/MUTATION_AUTHORITY_SPEC.md.
export * from './mutation-authority.schema.js';

// ---------------------------------------------------------------------------
// Wave 18T — Cognitive Engine (reasoning + grounding + adaptive-ingest
// foundation that sits underneath all 5 atomic capabilities)
// ---------------------------------------------------------------------------
// Three tables backing migration 0024_cognitive_engine.sql:
// cognitive_turns (per-kernel-turn reasoning + outcome),
// ingested_attachments (adaptive-ingest payloads as DataJoinRef),
// clarifying_question_history (3-question per-turn cap enforcement).
// See docs/DESIGN/COGNITIVE_ENGINE_SPEC.md.
export * from './cognitive-engine.schema.js';

// ---------------------------------------------------------------------------
// Wave 18V — Junior Architecture (27 juniors as MD-class within scope)
// ---------------------------------------------------------------------------
// Two tables backing migration 0025_junior_architecture.sql:
// junior_personas (global registry of every JuniorPersona),
// agent_turns (tenant-scoped per-turn ledger linked to cognitive_turns).
// See docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md.
export * from './junior-architecture.schema.js';

// ---------------------------------------------------------------------------
// Wave 18X — Org Hierarchy + Terminology (multi-level MD foundation)
// ---------------------------------------------------------------------------
// Three tables backing migration 0026_org_scope_hierarchy.sql:
// org_units (recursive tree per tenant),
// user_scope_bindings (many-to-many user × scope with role + tier),
// terminology_overrides (per-tenant + per-org-unit catalogue override).
// See docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md.
export * from './org-scope.schema.js';
