/**
 * Schema exports for Borjie database.
 *
 * Re-exports every Drizzle table for the Borjie mining-domain platform.
 * Property-domain pre-Borjie tables (buildings, units, leases, vendors,
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
// Wave COMPANY-BRAIN (C-1) — lossless ingestion lineage.
//   - corpus_doc_uploads:    pending → parsing → chunking → embedded → indexed
//   - corpus_doc_summaries:  bilingual digest per upload (en + sw)
// Append-only memory tables; see Docs/OPS/MEMORY_DURABILITY.md.
export * from './corpus-doc-uploads.schema.js';

// Wave COMPANY-BRAIN (C-5) — Day-1 jumpstart gating state.
//   - onboarding_state: one row per tenant; gates the celebratory
//     Day-1 chat block + welcome cockpit-event so it fires once.
// Append-only memory table (upsert-only at the app layer).
export * from './onboarding-state.schema.js';

// Tenant-signup onboarding persistence (migration 0188 / KI-013 closure).
// Three pre-tenant system tables: owner_onboarding_credentials,
// onboarding_signup_sessions, onboarding_email_verifications.
// RLS FORCE-enabled with service-managed policy — see schema file for
// the full security-model rationale.
export * from './onboarding-signup.schema.js';

// Onboarding-session durable store (RSS-09). One tenant-scoped table
// (onboarding_sessions) backing the move-in OnboardingRepository in
// routes/onboarding.ts, replacing the in-memory Map triple so onboarding
// state survives a restart and is shared across replicas. Migration
// 0314_onboarding_session_store.sql; FORCE RLS on the canonical
// app.current_tenant_id GUC + service-role bypass.
export * from './onboarding-sessions.schema.js';

// Mining onboarding-wizard run state (migration 0286 / FLOW-2). One row per
// owner onboarding run: current_step + status + an append-only steps jsonb of
// each advanced step's payload (incl. uploaded file refs) so a reload resumes.
// FORCE RLS on the canonical app.current_tenant_id GUC.
export * from './mining-onboarding-runs.schema.js';

// Brain sleep-pass durability (migration 0276 / LP-21a). Two SYSTEM tables —
// brain_sleep_runs + brain_sleep_emissions — replacing the in-memory Map in
// services/sleep-pass-orchestrator. Cross-tenant brain-job rows written under
// the service-role connection (no per-tenant GUC); RLS FORCE-enabled with a
// service-managed policy + REVOKE anon/authenticated — see schema file.
export * from './brain-sleep-runs.schema.js';

// Epistemic belief layer + learning loop (migration 0274 / LP-17/18). Seven
// tenant-scoped tables — brain_beliefs, belief_revisions, belief_review_queue,
// learning_signals, preference_pairs, preference_head_weights,
// correlation_findings. RLS FORCE-enabled + REVOKE anon/authenticated — see
// schema file. Belief writes flow only through the convince-loop guard.
export * from './belief-learning.schema.js';

// Mining-domain extensions (migration 0005)
export * from './buyer-extensions.schema.js';
export * from './bid-negotiations.schema.js';
export * from './ore-grade-snapshots.schema.js';
export * from './ore-stockpiles.schema.js';

// Mining-domain workforce + marketplace extensions (migration 0007)
export * from './mining-workforce-extensions.schema.js';

// Workforce Invitations — owner/admin invites + worker activation (migration 0086)
export * from './workforce-invitations.schema.js';

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
export * from './platform-autonomy-settings.schema.js';
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
// Portal-genui dynamic tabs (migration 0170) — the MD-authored "infinite
// dynamic tabs" store. Sibling of portal_layouts; backs @borjie/portal-genui's
// PortalTab document. Consumed by the portal-genui composition wiring +
// migration introspection tests.
export * from './portal-tabs.schema.js';
export * from './worm-audit-log.schema.js';
export * from './lesson-store.schema.js';
export * from './aop-registry.schema.js';

// A2A task store
export * from './a2a-tasks.schema.js';

// Document drafts registry (contracts/RFPs/letters/notices/memos)
export * from './drafts.schema.js';

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

// Polymorphic core-entity (Piece A) + the routing_rules dispatch matrix
// (the Piece B module-spawning tables were removed as false drift; see
// ./modules/index.js).
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
// Wave 18AA — Unified Cognitive Memory (Mr. Mwikila is ONE mind)
// ---------------------------------------------------------------------------
// Three tables backing migration 0029_cognitive_memory.sql:
// cognitive_memory_cells (unified shared semantic memory store with pgvector),
// cognitive_memory_reinforcements (cross-specialisation audit trail),
// platform_memory_cells (federated cross-tenant cells, PII-stripped, no RLS).
// See docs/DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md.
export * from './cognitive-memory.schema.js';

// ---------------------------------------------------------------------------
// MEM-01 — six-layer memory-v2 durable stores (episodic, narrative,
// procedural, reflective, topic, cohort). Seven tables backing migration
// 0312_memory_v2_durable_stores.sql so `@borjie/memory-v2` survives a
// process restart. Companion: packages/memory-v2/src/*/store-drizzle.ts.
export * from './memory-v2.schema.js';

// ---------------------------------------------------------------------------
// Wave 18V — Junior Architecture (27 juniors as MD-class within scope)
// ---------------------------------------------------------------------------
// Two tables backing migration 0025_junior_architecture.sql:
// junior_personas (global registry of every JuniorPersona),
// agent_turns (tenant-scoped per-turn ledger linked to cognitive_turns).
// See docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md.
export * from './junior-architecture.schema.js';

// Wave 18V-DYNAMIC — junior_turn_feedback (per-turn satisfaction signal)
// backing migration 0028_junior_dynamic_lifecycle.sql. New columns on
// junior_personas live in 0028 too but are accessed via raw SQL or the
// in-memory repository in @borjie/agent-platform/junior-spawner.
// See Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md.
export * from './junior-lifecycle.schema.js';

// ---------------------------------------------------------------------------
// Wave 18HH — Swarm Coordination (active registry + A2A + blackboard +
// conflicts). Four tables backing migration 0060_swarm_coordination.sql
// (renumbered from 0030 to resolve collision with 0030_persistent_memory.sql):
// active_agents, agent_messages, blackboard_postings, coordination_conflicts.
// See Docs/DESIGN/AGENT_SWARM_COORDINATION_SOTA.md.
export * from './swarm-coordination.schema.js';

// ---------------------------------------------------------------------------
// Wave 18X — Org Hierarchy + Terminology (multi-level MD foundation)
// ---------------------------------------------------------------------------
// Three tables backing migration 0026_org_scope_hierarchy.sql:
// org_units (recursive tree per tenant),
// user_scope_bindings (many-to-many user × scope with role + tier),
// terminology_overrides (per-tenant + per-org-unit catalogue override).
// See docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md.
export * from './org-scope.schema.js';

// ---------------------------------------------------------------------------
// Wave 18Z — Customer Geo Routing + Session Scopes
// ---------------------------------------------------------------------------
// Four tables backing migration 0027_geo_routing_session_scopes.sql:
// customer_locations (versioned snapshot per customer),
// org_unit_service_areas (geographic territory per org_unit),
// customer_district_assignments (current routing per customer),
// session_scopes (JWT/cookie companion for every authenticated session).
// See Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md.
export * from './geo-routing.schema.js';

// ---------------------------------------------------------------------------
// Wave 18DD — Agent Self-Revival (wave_progress + wave_revival_attempts)
// ---------------------------------------------------------------------------
// Two platform-level orchestration tables backing migration
// 0059_wave_resilience.sql (renumbered from 0029 to resolve collision
// with 0029_cognitive_memory.sql). Consumed by services/wave-resilience-manager.
// See Docs/DESIGN/AGENT_SELF_REVIVAL_SPEC.md.
export * from './wave-resilience.schema.js';

// ---------------------------------------------------------------------------
// Wave 18GG — Persistent Memory + Skill Library (temporal continuity)
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0030_persistent_memory.sql:
//   session_memory   — short-term tier, sliding-TTL working snapshot
//   skills           — procedural memory tier (Voyager-style library)
//   pending_threads  — anti-amnesia checkpoint table
//   thread_summaries — MemGPT-style summarised turn-block records
// Consumed by @borjie/persistent-memory.
// See Docs/DESIGN/MEMORY_AMNESIA_PREVENTION_SOTA.md.
export * from './persistent-memory.schema.js';

// ---------------------------------------------------------------------------
// Ephemeral Software — Function-Attached Dashboard Telemetry
// ---------------------------------------------------------------------------
// Single tenant-scoped table backing migration 0031_ephemeral_dashboard.sql:
//   ephemeral_dashboard_telemetry — one row per compose call by
//                                   @borjie/ephemeral-ui. Audit + replay
//                                   key + promotion-decider's source of
//                                   truth. TabRecipes themselves are
//                                   NEVER persisted (lifecycle = compose
//                                   → render → telemetry → discard | promote).
// Consumed by @borjie/ephemeral-ui.
// See Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md and
// Docs/STRATEGY/EPHEMERAL_SOFTWARE_SOTA.md.
export * from './ephemeral-dashboard-telemetry.schema.js';

// ---------------------------------------------------------------------------
// Wave M2 — Daily Follow-up + Persona Voice
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0034_followup_voice.sql:
//   followup_candidates   — owner-facing proactive nudge queue (one row
//                           per scheduled / sent / dismissed follow-up).
//   followup_preferences  — per-user allowed channels + quiet-hours +
//                           daily cap. PK is (tenant_id, user_id).
//   persona_voice_mode    — per-user guide / learn / balanced voice mode
//                           + verbosity dial. PK is (tenant_id, user_id).
// Consumed by @borjie/user-followup and @borjie/persona-voice.
// See Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md.
export * from './followup-voice.schema.js';

// ---------------------------------------------------------------------------
// Wave 18BB-MCP-EXT — MCP External Client (consume the public MCP ecosystem)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0033_mcp_external_connections.sql:
//   mcp_external_connections — per-tenant connection records to public MCP
//                              servers (Slack, GitHub, Notion, GDrive, …).
//                              `encrypted_credentials` is AES-GCM ciphertext.
//   mcp_tool_invocations     — per-invocation audit log; cross-walks into
//                              ai_audit_chain via `audit_chain_id`.
// Consumed by @borjie/agent-platform/src/mcp-external-client.
// See Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md.
export * from './mcp-external-connections.schema.js';

// ---------------------------------------------------------------------------
// Wave 19F — Voice channel + Swahili gauntlet (village MDs via voice)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0062_voice_swahili.sql
// (renumbered from 0034 to resolve collision with 0034_followup_voice.sql):
//   voice_sessions             — one row per live caller session
//                                (whatsapp / sms / app / pstn). Provider,
//                                latency, demotion history.
//   swahili_gauntlet_results   — one row per gauntlet utterance run; WER +
//                                MOS drift dashboard substrate.
// Consumed by @borjie/voice-agent/src/gemini-live + swahili-gauntlet.
// See Docs/DESIGN/VOICE_GEMINI_LIVE_SWAHILI_SPEC.md.
export * from './voice-swahili.schema.js';

// ---------------------------------------------------------------------------
// Wave M3-M4 — Five-Layer Loop Architecture
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0035_loop_architecture.sql:
//   loop_runs              — one row per end-to-end 5-layer loop execution
//                            (sensors → policy → tools → quality → learning).
//                            Hash-chained by `prev_hash`.
//   loop_layer_outcomes    — one row per executed layer; captures outcome
//                            jsonb + latency + cost + audit hash.
//   loop_quality_signals   — one row per Layer 4 gate signal (groundedness,
//                            calibration, brand, authority, budget, …).
// Consumed by @borjie/loop-runner + @borjie/loop-quality-gates.
// See Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
export * from './loop-architecture.schema.js';

// ---------------------------------------------------------------------------
// Wave M5 — Tab as Loop (server-anchored persistent tabs)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0036_tab_as_loop.sql:
//   tab_sessions  — one row per (user, tab_kind, scope). Canonical
//                    state jsonb; lifecycle timestamps; hash-chained.
//   tab_events    — one row per applied client→server delta. Replayed
//                    in iteration order on hydrate.
// Consumed by @borjie/tab-as-loop.
// See Docs/DESIGN/TAB_AS_LOOP_SPEC.md §12-19.
export * from './tab-as-loop.schema.js';

// ---------------------------------------------------------------------------
// Wave M6 — Org Legibility (live, queryable, brand-locked org map)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0063_org_legibility.sql
// (renumbered from 0037 to resolve collision with
// 0037_calibration_interpretability.sql):
//   legibility_snapshots — reconciled authoritative LegibilityMap per
//                           (tenant, scope, snapshot_at). Public +
//                           internal variants; juniors only in
//                           internal_snapshot.
//   legibility_deltas    — event-driven deltas applied forward from
//                           the previous snapshot.
// Consumed by @borjie/legibility.
// See Docs/DESIGN/ORG_LEGIBILITY_SPEC.md §14-21.
export * from './org-legibility.schema.js';

// ---------------------------------------------------------------------------
// Wave M7 — Information Synthesis SOTA (diorize pipeline persistence)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0038_info_synthesis.sql:
//   synth_runs    — pipeline invocation ledger (query + corpus + status
//                    + audit chain pointers).
//   synth_outputs — emitted synthesis (text + citations + calibrated
//                    confidence + disagreements + audit hash).
// Consumed by @borjie/info-synthesis.
// See Docs/DESIGN/INFORMATION_SYNTHESIS_SOTA_SPEC.md.
export * from './info-synthesis.schema.js';

// ---------------------------------------------------------------------------
// Wave M8-M9 — On-Demand Internal Software (sealed-bundle persistence)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0039_internal_software.sql:
//   internal_tools     — registry of MD-generated tools (sealed bundle:
//                         form + handler + archetype + audit hook),
//                         lifecycle state, authority tier.
//   internal_tool_runs — per-execution ledger (inputs, outputs, actor,
//                         audit hash for forensic replay).
// Consumed by @borjie/internal-software-generator.
// See Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md.
export * from './internal-software.schema.js';

// ---------------------------------------------------------------------------
// P0 #1 Closure (18BB gap analysis) — PRM + MCTS Reasoning Traces
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0040_reasoning_traces.sql:
//   reasoning_traces        — full (state, step, observation) trajectory
//                              captures. `outcome_label` NULL until
//                              verified (regulator portal / payment /
//                              human).
//   prm_training_examples   — labeled (state, step, label) pairs derived
//                              by the Math-Shepherd completer technique.
//                              Training substrate for the learned PRM
//                              (Phase 2 / 19C).
//   mcts_search_tree_dumps  — per-invocation MCTS audit + replay store.
//                              Tree, budget, selected path, termination
//                              reason, wall-clock.
// Consumed by @borjie/process-reward-model.
// See Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md.
export * from './reasoning-traces.schema.js';

// ---------------------------------------------------------------------------
// OMNI-P0-BATCH-2 — WhatsApp / Notion / Google Drive ingest connectors
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0043_omni_p0_batch2.sql:
//   whatsapp_messages — inbound + outbound message ledger (WhatsApp
//                        Business Cloud API). Webhook + 6h reconciliation
//                        poll. UNIQUE on (tenant_id, waba_id, wa_message_id).
//   notion_pages      — Notion page metadata + property bag.
//   notion_blocks     — Notion block tree (incl. comments).
//   drive_files       — Google Drive file metadata + extracted plain text
//                        for native gdoc / gsheet / gslide.
// Connector credentials + cursors live in connector_credentials /
// connector_cursors (owned by sibling OMNI-P0-BATCH-1 migration 0042).
// See Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md.
export * from './connector-whatsapp.schema.js';
export * from './connector-notion.schema.js';
export * from './connector-google-drive.schema.js';

// ---------------------------------------------------------------------------
// Wave HARVEST — Tacit Knowledge Harvest (5-mode interview engine)
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0044_tacit_knowledge.sql:
//   tacit_interviews  — one row per harvest session (walk-the-floor,
//                       post-incident, ride-along, deal-replay,
//                       cross-role). transcript jsonb + geography(POINT).
//   tacit_extractions — one row per extracted know-how artifact;
//                       links to tacit_interviews.id; carries
//                       entity_kind, confidence, novel, redundant_with,
//                       persisted_cell_id.
//   tacit_consents    — (subject_user_id, tenant_id) PK. Default
//                       'granted'. Subject owns their knowledge and
//                       can revoke at any time.
// Consumed by @borjie/tacit-knowledge.
// See Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md.
export * from './tacit-knowledge.schema.js';

// ---------------------------------------------------------------------------
// Wave M1 — Continuous 24/7 Work Cycle
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration 0061_work_cycle.sql
// (renumbered from 0033 to resolve collision with
// 0033_mcp_external_connections.sql):
//   work_cycle_journal — append-only journal of every tick. Hash-chained
//                        via (prev_hash, audit_hash). Unique on
//                        (tenant_id, tick_no). The episodic-memory + audit
//                        substrate for Mr. Mwikila's continuous loop.
//   work_cycle_state   — one row per tenant. Holds last_tick_no,
//                        last_tick_at, current_mode, pending_threads.
//                        Updated atomically with each journal append.
// Consumed by @borjie/work-cycle.
// See Docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md.
export * from './work-cycle.schema.js';

// ---------------------------------------------------------------------------
// Wave 19C — RLVR Post-Training Pipeline (verifiable-reward orchestration)
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0065_rlvr.sql (renumbered
// from 0041 to resolve collision with 0041_graph_rag.sql):
//   rlvr_runs              — one row per end-to-end RLVR pipeline run.
//                             Lifecycle status + verifier_set + PO-14
//                             hash chain.
//   rlvr_traces            — captured Mr. Mwikila traces. Raw + salted-
//                             hash redacted; only the redacted form may
//                             leave the tenant boundary.
//   rlvr_verifications     — per-(trace, verifier) verdict
//                             (pass|fail|partial|skip) + reward in [0,1]
//                             + evidence jsonb.
//   rlvr_curated_examples  — (prompt, completion, reward) tuples with
//                             included/exclusion_reason mutually exclusive
//                             for audit forensics.
// Consumed by @borjie/post-training-rlvr.
// See Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md.
export * from './rlvr.schema.js';

// ---------------------------------------------------------------------------
// Wave OMNI-P0-BATCH-1 — Slack + Email + Calendar connectors
// ---------------------------------------------------------------------------
// Five tenant-scoped tables backing migration 0042_omni_p0_batch1.sql:
//   connector_credentials — per-tenant per-account OAuth state. Tokens are
//                            AES-GCM ciphertext sealed with a tenant-bound
//                            DEK; the database NEVER sees plaintext.
//   connector_cursors     — per (tenant, kind, account) ingest cursor.
//                            Opaque text — provider-defined.
//   slack_messages        — canonical Slack message row (post-PII-
//                            redaction). UNIQUE on (tenant_id, workspace_id,
//                            channel_id, ts).
//   email_messages        — canonical Gmail + Outlook mail row. Address
//                            fields are salted-sha256 hashes.
//   calendar_events       — canonical Google + Outlook calendar event row.
// Consumed by @borjie/connector-slack, @borjie/connector-email,
// @borjie/connector-calendar.
// See Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md.
export {
  connectorCredentials,
  connectorCursors,
  slackMessages,
  type ConnectorCredentialsRow,
  type ConnectorCredentialsInsert,
  type ConnectorCursorRow,
  type ConnectorCursorInsert,
  type SlackMessageRow,
  type SlackMessageInsert,
} from './connector-slack.schema.js';
export {
  emailMessages,
  type EmailMessageRow,
  type EmailMessageInsert,
} from './connector-email.schema.js';
export {
  calendarEvents,
  type CalendarEventRow,
  type CalendarEventInsert,
} from './connector-calendar.schema.js';

// ---------------------------------------------------------------------------
// P0 #2 Closure (18BB gap analysis) — GraphRAG Router
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0041_graph_rag.sql:
//   knowledge_graph_entities    — de-duped entity nodes with pgvector(1536)
//                                  embedding for graph-local fan-out.
//   knowledge_graph_relations   — typed edges between entities (weight
//                                  accumulates on mention).
//   kg_communities              — Leiden/Louvain hierarchical clusters.
//                                  `signature_hash` drives drift detection.
//   kg_community_summaries      — LLM-generated summaries (append-only,
//                                  regen only on signature drift).
// Consumed by @borjie/graph-rag-router + the nightly
// `graph-rag-community-summaries` sleep pass.
// See Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md.
export * from './graph-rag.schema.js';

// ---------------------------------------------------------------------------
// Wave M10–M12 — Strategic Direction Layer
// ---------------------------------------------------------------------------
// Six tenant-scoped tables backing migration 0064_strategic_layer.sql
// (renumbered from 0040 to resolve collision with 0040_reasoning_traces.sql):
//   north_star_objectives  — durable goal record (OKR-shaped) with
//                            proposed/active/met/missed/retired state
//                            machine. T2 events flow through
//                            @borjie/mutation-authority.
//   objective_progress     — append-only observation log per objective.
//                            Velocity + drift signal computed off the
//                            latest rows.
//   pivot_proposals        — LLM-drafted retarget / reframe / retire
//                            recommendations when drift goes off_track
//                            for ≥7 days. T2 owner-in-the-loop.
//   federation_consents    — per-tenant opt-in gate for cognitive-memory
//                            cross-tenant federation. Default deny;
//                            scoped (patterns / rules / terminology /
//                            failures / all); expiring; prospective
//                            revocation.
//   epsilon_budgets        — per-tenant per-period (monthly) Rényi-DP
//                            budget cap. PK is (tenant_id, period_start).
//   epsilon_ledger         — append-only ε-charge audit log; idempotent
//                            on (tenant_id, op_kind, op_id).
// Consumed by @borjie/strategic-layer.
// See Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md §15.
export * from './strategic-layer.schema.js';

// ---------------------------------------------------------------------------
// Wave 19H — Swahili Linguistics (morphology + dialect + bilingual glossary)
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0049_swahili_linguistics.sql:
//   swahili_terms              — bilingual glossary entries (term, lemma,
//                                noun class, register, domain tag).
//                                Mining-domain seed lives in TS.
//   swahili_morphology_cache   — memoised morphological analyses per
//                                surface form; verb / noun decompositions.
//   swahili_dialect_signals    — per-user dialect-signal counters that
//                                drive register adaptation.
// Consumed by @borjie/swahili-linguistics.
// See Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md.
export * from './swahili-linguistics.schema.js';

// ---------------------------------------------------------------------------
// Wave 19I — Translation SOTA (bidirectional EN<->SW with terminology lock)
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0050_translation_sota.sql:
//   translation_runs                  — one row per translation call
//                                       (provider invocation). Stores
//                                       source/target text, provider used,
//                                       glossary terms substituted, code-
//                                       switch segments, BLEU / chrF /
//                                       terminology-adherence, latency,
//                                       cost. Hash-chained.
//   translation_glossary_overrides    — per-tenant term overrides on top of
//                                       the bundled mining + Wave-19H domain
//                                       glossaries. UNIQUE on (tenant_id,
//                                       src_term, src_lang, target_lang,
//                                       register).
//   translation_evals                 — per-(run, judge) eval score. judge
//                                       in {bleu, chrf, comet,
//                                       terminology-adherence, human}.
// Consumed by @borjie/translation-sota.
// See Docs/DESIGN/TRANSLATION_SOTA_SPEC.md.
export * from './translation-sota.schema.js';

// ---------------------------------------------------------------------------
// P0 #5 Closure (18BB gap analysis) — Calibration + Interpretability
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration
// 0037_calibration_interpretability.sql:
//   calibration_observations    — one row per Tier-1+ Mr. Mwikila
//                                 prediction at decision time. The
//                                 outcome_* + resolved_at columns are
//                                 filled later by the outcome resolver
//                                 (owner approve/reject, real-world
//                                 outcome, manual backfill). Triple
//                                 (tenant, kind, entity) is unique.
//   calibration_weekly_reports  — one row per (tenant, prediction_kind,
//                                 period). Emitted by the weekly-report
//                                 generator. Stores brier_score, ece,
//                                 sample_size, full reliability_diagram.
//   sae_probe_features          — one row per fired SAE feature per
//                                 probe call. Seven sensitive categories
//                                 tracked (deception, hallucination,
//                                 bias, sycophancy, prompt_injection,
//                                 self_reference, confidentiality_leak).
// Consumed by @borjie/calibration-monitor and @borjie/sae-probe.
// See Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md.
export * from './calibration-interpretability.schema.js';

// ---------------------------------------------------------------------------
// Wave CAPABILITY — Capability Catalogue + Measurement
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0045_capability_catalogue.sql:
//   capabilities             — the registry. UNIQUE (tenant_id, name,
//                              version). Seed capabilities use tenant_id
//                              = '__seed__' and are visible cross-tenant
//                              on SELECT.
//   capability_invocations   — one row per call. Powers competence axis.
//   capability_outcomes      — one row per resolved outcome (FK to
//                              invocation). Powers calibration + utility.
//   capability_measurements  — one row per (capability, window) per tick
//                              (7d / 28d / 91d). Drives lifecycle
//                              promotion + demotion.
// Consumed by @borjie/capability-catalogue and
// services/capability-measurement-worker.
// See Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md.
export * from './capability-catalogue.schema.js';

// ---------------------------------------------------------------------------
// Wave SELFIMPROVE — meta-learning conductor + DP federation
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0047_selfimprove_omni_p2.sql:
//   meta_learning_runs       — one row per meta-learning-conductor run.
//                              status lifecycle scheduled → running →
//                              succeeded | failed. Decision in
//                              promote | demote | no-op | rollback.
//                              audit-chained per (tenant, capability).
//   meta_learning_examples   — one row per curated example (prompt,
//                              completion, reward, included). FK on
//                              meta_run_id.
//   dp_charges               — one row per DP operation; per-operation
//                              accounting ground truth. The
//                              strategic-layer's `epsilon_budgets`
//                              sums these rows for the owner-facing
//                              privacy ledger.
// Consumed by @borjie/meta-learning-conductor + @borjie/dp-federation.
// See Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
export * from './meta-learning.schema.js';
export * from './dp-federation.schema.js';

// ---------------------------------------------------------------------------
// Wave OMNI-P2 — Social-platform connectors (6 providers)
// ---------------------------------------------------------------------------
// Six tenant-scoped tables backing migration 0047_selfimprove_omni_p2.sql:
//   instagram_posts          — Instagram Graph API ingest. UNIQUE on
//                              (tenant_id, account, post_id).
//   facebook_posts           — Facebook Page Graph ingest. Same shape.
//   tiktok_posts             — TikTok Business API ingest. Same shape.
//   x_posts                  — X (formerly Twitter) v2 API ingest. Has
//                              `text` column for tweet body instead of
//                              `caption`.
//   linkedin_posts           — LinkedIn Marketing API ingest. Same shape
//                              as Facebook.
//   youtube_videos           — YouTube Data API v3 ingest. Distinct
//                              shape: (tenant, channel, video) keys;
//                              dedicated view/like/comment count
//                              columns and duration_s.
// Consumed by @borjie/connector-{instagram,facebook,tiktok,x,linkedin,youtube}.
// See Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md.
export * from './connector-instagram.schema.js';
export * from './connector-facebook.schema.js';
export * from './connector-tiktok.schema.js';
export * from './connector-x.schema.js';
export * from './connector-linkedin.schema.js';
export * from './connector-youtube.schema.js';

// ---------------------------------------------------------------------------
// Wave 19J — Ambient voice listening
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0051_ambient_listening.sql:
//   ambient_consents              — composite (tenant, user, channel) PK.
//                                   Drives the silent-disable gate.
//   ambient_captures              — one row per pipeline capture; redacted
//                                   text + intent + entities + sentiment.
//                                   Hash-chained.
//   ambient_kill_switch_events    — append-only kill-switch audit.
// Consumed by @borjie/ambient-listener + services/voice-agent/src/ambient.
// See Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md.
// Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
// (Decisions 3 + 4).
export * from './ambient-listening.schema.js';

// ---------------------------------------------------------------------------
// Wave 19K — Language Self-Improvement Loop
// ---------------------------------------------------------------------------
// Four tenant-scoped tables backing migration 0052_language_self_improve.sql:
//   language_training_pairs   — captured (source, target) utterance pair
//                                + 4-axis scores (WER, PER, grammar,
//                                terminology). PII redacted before
//                                persistence.
//   language_adapters         — per-(tenant, lang) adapter. Kind in
//                                (lora, rag-prefix, full-ft). Lifecycle:
//                                training → staged → live → rolled-back |
//                                deprecated. UNIQUE(tenant, lang, version).
//   language_eval_runs        — gauntlet eval run. 4 mechanical axes +
//                                nullable MOS + PromotionDecider decision.
//   language_gauntlet_entries — per-tenant additions to the base 200-
//                                utterance set. UNIQUE(tenant, lang, prompt).
// Consumed by @borjie/language-self-improve.
// See Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md.
// Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
// (Decisions 3 + 4).
export * from './language-self-improve.schema.js';

// ---------------------------------------------------------------------------
// Wave 19G — Language-SOTA core (Mr. Mwikila bilingual mind)
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration 0048_language_sota.sql:
//   language_utterances        — captured utterances across voice / chat /
//                                 sms / whatsapp with phonemes, prosody, and
//                                 code-switch segments. Consent-gated per
//                                 FOUNDER_LOCKED §3 + §4; hash-chained.
//   language_provider_quality  — periodic (provider, language) WER + PER +
//                                 MOS samples driving the routing decision.
//   language_user_profile      — per-user preferred / secondary language,
//                                 dialect tags, pronunciation profile.
//                                 PK is (tenant_id, user_id).
// Consumed by @borjie/language-sota and downstream waves 19H–19K.
// See Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md.
// Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
// (Decisions 3 + 4).
export * from './language-sota.schema.js';

// ---------------------------------------------------------------------------
// Barrel-stability block (additive, alphabetised) — SCRUB-6
// ---------------------------------------------------------------------------
// Every *.schema.ts file under this directory MUST be reachable from this
// barrel so downstream packages can rely on `@borjie/database/schemas` as a
// stable single import surface. The block below covers schemas that landed
// after the original commentary blocks were authored. Entries are sorted
// alphabetically; do NOT remove an entry once added — rename in place or
// supersede with a more specific block above. Guards against the
// barrel-flicker observed during parallel agent races.
export * from './connector-github.schema.js';
export * from './connector-gitlab.schema.js';
export * from './connector-hubspot.schema.js';
export * from './connector-jira.schema.js';
export * from './connector-linear.schema.js';
export * from './connector-salesforce.schema.js';
export * from './connector-teams.schema.js';
export * from './connector-voice.schema.js';
export * from './connector-zoom.schema.js';
export * from './marketing-promotion.schema.js';

// ---------------------------------------------------------------------------
// UNIV-2 — Universal Language Packs (migration 0056)
// ---------------------------------------------------------------------------
// Global, NOT tenant-scoped reference registry backing migration
// 0056_universal_language_packs.sql:
//   language_pack_definitions  — one row per pack (live or reserved).
//                                30 rows at launch (2 live: en, sw;
//                                28 reserved). NO RLS — global ref.
// Consumed by @borjie/language-packs.
// See Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md.
export * from './universal-language-packs.schema.js';

// ---------------------------------------------------------------------------
// Wave PERF-1 — Employee Daily Performance Follow-up (migration 0058)
// ---------------------------------------------------------------------------
// Three tenant-scoped tables backing migration
// 0058_employee_perf_followup.sql:
//   kpi_templates        — per-(tenant, role) catalogue of KPI definitions.
//                          Seed rows live under sentinel tenant_id
//                          '__seed__' and are read-visible cross-tenant.
//                          UNIQUE(tenant_id, role).
//   employee_scorecards  — one row per (tenant, employee, date) with
//                          per-KPI raw measurements + computed bands +
//                          overall_score + signals. Hash-chained via
//                          (prev_hash, audit_hash). UNIQUE(tenant_id,
//                          employee_user_id, date).
//   perf_nudges          — one row per dispatched nudge.
//                          recipient_tier in {subject, supervisor, owner}
//                          per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §3.
// Consumed by @borjie/employee-perf-followup.
// See Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md.
export * from './employee-perf-followup.schema.js';

// ---------------------------------------------------------------------------
// Wave 18M — Dynamic Authored Recipes (migration 0066)
// ---------------------------------------------------------------------------
// One tenant-scoped table backing migration
// 0066_dynamic_authored_recipes.sql:
//   dynamic_authored_recipes — LLM-authored, lifecycle-governed
//                              registry of dynamic recipes (tab | doc |
//                              media | campaign | tool). One row per
//                              (tenant_id, kind, name, version) with
//                              prev_hash + audit_hash for forensic
//                              replay against the per-tenant authoring
//                              chain.
// Consumed by @borjie/dynamic-recipe-authoring.
// See Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md.
export * from './dynamic-authored-recipes.schema.js';

// ---------------------------------------------------------------------------
// Wave INTEL-SELF-IMPROVE — Intel Self-Improve Wiring (migration 0072)
// ---------------------------------------------------------------------------
// Two tenant-scoped tables backing migration
// 0072_intel_self_improve.sql:
//   intel_invocation_audit — one row per intel call (forecast | stat |
//                            graph_db | causal | anomaly |
//                            recommendation). FK to capabilities.id.
//                            observed_outcome populated later by the
//                            outcome-observer cron. Hash-chained per
//                            (tenant_id, intel_kind).
//   intel_skill_traces     — per-(tenant, intel_kind,
//                            pattern_signature) success/failure
//                            counter. Powers Voyager-style skill reuse
//                            (Wang et al., arXiv 2305.16291).
//                            UNIQUE on the triple.
// Consumed by @borjie/intel-self-improve.
// See Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
export * from './intel-self-improve.schema.js';

// ---------------------------------------------------------------------------
// Wave BLACKBOARD-CORE — Blackboard SOTA (migration 0073)
// ---------------------------------------------------------------------------
// Five tenant-scoped tables backing migration
// 0073_blackboard_sota.sql:
//   blackboard_regions             — per-namespace problem-solving
//                                    scope. region_kind enumeration
//                                    incident-investigation,
//                                    royalty-filing-prep,
//                                    buyer-deal-room, shift-planning,
//                                    regulator-correspondence,
//                                    deep-research-session,
//                                    dashboard-composition. Per-region
//                                    audit chain.
//   blackboard_knowledge_sources   — KS registry. ks_kind in
//                                    {junior, connector, tool, user,
//                                    external-feed}. UNIQUE on
//                                    (tenant_id, ks_kind, ks_name).
//   blackboard_posts_v2            — threaded posts with embeddings.
//                                    Successor to 18HH's
//                                    blackboard_postings. content +
//                                    vector(1536). Hash-chains into
//                                    the region's chain.
//   blackboard_cross_references    — detected post-to-post links.
//                                    ref_kind in {cites, contradicts,
//                                    answers, supersedes, elaborates}.
//   blackboard_summaries           — rolling / final / digest
//                                    summaries. covers_from /
//                                    covers_to fence the window.
// Consumed by @borjie/blackboard-sota.
// See Docs/DESIGN/BLACKBOARD_SOTA_2026.md.
export * from './blackboard-sota.schema.js';

// ---------------------------------------------------------------------------
// Wave OWNER-OS — owner reminders + dynamic tabs (migration 0089)
// ---------------------------------------------------------------------------
//   reminders   — owner-scheduled events. trigger_at + channel + payload;
//                 the reminders-dispatch worker fires by email (default),
//                 SMS (africastalking), or Slack (webhook). Idempotency
//                 key prevents double-fire under retry. RLS-forced.
//   owner_tabs  — per-(tenant, user) tab strip state for the owner-web
//                 dashboard. Stored as a single jsonb document so the FE
//                 zustand store hydrates + persists in one round-trip.
// Consumed by services/api-gateway/src/routes/owner/{reminders,tabs}.hono.ts
// and the reminders-dispatch worker.
export * from './owner-reminders.schema.js';
export * from './owner-tabs.schema.js';
// Wave MD-WRITE-PARITY (migration 0169) — server-PERSISTED, per-tab structural
// store for the owner cockpit strip. Promotes tab structure from the opaque
// single-jsonb `owner_tabs` blob to one queryable row per (tenant, user, tab_id)
// so the action-executor `manage_tab` verb persists spawn/update/remove/reorder/
// pin server-side instead of FE-chip-only.
export * from './owner-tabs-structural.schema.js';
// Wave BRAIN-UI-CONTROL (migration 0097) — per-user dashboard tile order
// + sidebar order + hash-chained ui_redesign_audit.
export * from './owner-dashboard-layout.schema.js';
export * from './ui-redesign-audit.schema.js';
// Companion to migration 0079 — already on disk but was missing from the
// barrel; re-export so brief.hono.ts can pull `ownerBriefSnapshots` from
// `@borjie/database` like every other tenant schema.
export * from './owner-brief.schema.js';

// Wave OWNER-CONTACT-RESOLVER (migration 0098). Per-owner channel /
// address resolver — replaces the BORJIE_OWNER_FALLBACK_EMAIL env-var
// crutch used by the reminders worker.
export * from './owner-contact-prefs.schema.js';

// Wave FOUR-EYE-APPROVAL (migration 0099). Two-person sign-off on
// high-stakes owner actions (payment > 5M TZS, regulator filing,
// contract signature). Hash-chained into ai_audit_chain on every
// state change.
export * from './four-eye-requests.schema.js';

// Workflow-engine durable repos (migration 0307). Persist the
// @borjie/workflow-engine run aggregate, append-only transition log, and
// hashed per-tenant audit chain so /workflow runs, the four-eyes approval
// queue, and the audit chain survive an api-gateway restart (SOC 2 CC7.2).
export * from './workflow-runs.schema.js';
export * from './workflow-run-events.schema.js';
export * from './workflow-audit-chain.schema.js';

// Flow-keyed autonomy preferences (migration 0308). Per-flow sticky
// `auto | gated` posture + creation-time auto-vs-gated confirmation,
// the per-flow upgrade over the single global tenant_autonomy_caps
// switch. AUTO lets the workflow-engine skip the per-run approval step;
// the inviolable rails + autonomy-controller STILL gate per action.
export * from './flow-autonomy-prefs.schema.js';

// Wave WORKFORCE-CERT-EXPIRY (migration 0102). Per-employee mining
// certifications + dedup ledger for the cert-expiry reminder cron.
export * from './workforce-certifications.schema.js';

// Wave WORKFORCE-FIXED-TABS (migration 0091). Workers see FIXED tabs only;
// the owner sets the per-(role,scope) catalog + density via the owner-web
// configurator and approves / rejects worker change requests. Both tables
// hash-chain into ai_audit_chain on every create / decide / apply.
export * from './workforce-role-tab-configs.schema.js';

// Wave OWNER-OS DAILY-BRIEF rebuild (migration 0092). Append-only ledger
// for daily-brief dispatches — one row per (tenant, day, channel,
// recipient). UNIQUE constraint makes the cron's INSERT … ON CONFLICT
// DO NOTHING idempotent across ticks, restarts, and manual triggers.
export * from './daily-brief-dispatches.schema.js';

// Wave SUPERPOWERS (migrations 0111 / 0112 / 0113). Three tables back
// the universal "Borjie superpowers" — share links the chat brain can
// generate on the owner's behalf, a transient undo journal so every
// chat-initiated write earns an Undo chip, and per-owner pinned items
// for the quick-access strip.
export * from './share-links.schema.js';
export * from './undo-journal.schema.js';
export * from './pinned-items.schema.js';

// Admin four-eye superpowers queue (migration 0278). Ported from the
// BossNyumba admin-superpowers stack (BN 0301), retargeted real-estate →
// mining. The PENDING half of the two-phase admin bulk-action ledger:
// HIGH-risk verbs (suspend_licence_holder / export_regulator_pack /
// force_supply_agreement_termination / …) land as `pending` rows that a
// SECOND distinct admin must approve. The DB CHECK constraint
// `admin_four_eye_distinct_actors_chk` is the canonical same-actor guard.
// Tenant-scoped FORCE RLS on app.current_tenant_id. Consumed by
// services/api-gateway routes/admin/superpowers.hono.ts + the
// admin.superpowers.* brain tools.
export * from './admin-superpower-pending-approvals.schema.js';

// H2 deferral closure — server-side hard idempotency uniqueness
// (migration 0154). Backs services/api-gateway/src/middleware/
// db-idempotency.middleware.ts: partial unique indexes per tenant
// nullability variant make INSERT collisions the canonical dedup
// signal, eliminating the Redis split-brain race.
export * from './idempotency-keys.schema.js';

// Wave ENTITY-LEGIBILITY (migration 0115). Two tables make every
// entity in the system fully legible to AI: `entity_index` carries a
// semantic embedding + faceted tags + summary per entity so the brain
// can resolve any natural-language phrase to a concrete row;
// `entity_cross_references` carries typed edges so the brain can
// traverse the graph in one hop ("trace this incident back to its
// drill_hole assay"). RLS FORCE-enabled on both.
export * from './entity-index.schema.js';

// Wave CLOSED-LOOP (migration 0114). Three tables back the closed-loop
// telemetry contract: every action proposed by the brain (or taken by
// the owner / an agent / an external system) declares a predicted
// outcome, is reconciled against the observed outcome after N days,
// and feeds a learning_signal back so future predictions calibrate.
// Companions:
//   - services/api-gateway/src/workers/outcome-reconciliation-worker.ts
//   - services/api-gateway/src/composition/brain-tools/outcome-predictor.ts
//   - services/api-gateway/src/services/calibration-monitor/
export * from './outcome-telemetry.schema.js';

// Wave DECISION-LEGIBILITY (migration 0116). Three tables make every
// decision — owner-made, brain-suggested-and-applied, four-eye
// approved, or automated-policy enacted — fully legible: chosen value,
// alternatives considered, rationale, confidence, retrospective grade,
// and a link graph (supersedes / depends_on / informed_by / reversed_by).
// Hash-chained per @borjie/audit-hash-chain so auditors can verifyChain().
// Companions:
//   - services/api-gateway/src/services/decision-journal/recorder.ts
//   - services/api-gateway/src/workers/decision-retrospective-worker.ts
//   - services/api-gateway/src/composition/brain-tools/decision-journal-tools.ts
export * from './decision-journal.schema.js';

// ---------------------------------------------------------------------------
// Wave OPS-WIDE — full end-to-end mining operations scope (migration 0093)
// ---------------------------------------------------------------------------
//   external_parties              — every counterparty in the operation
//                                   (upstream licensing offices, downstream
//                                   processors / smelters / refiners /
//                                   assayers / exporters / banks / off-
//                                   takers, adjacent transport / CSR /
//                                   regulators / legal / insurance /
//                                   security). FORCE RLS.
//   external_party_engagements    — timeline of every interaction with a
//                                   counterparty. Hash-chain-audited.
//   mineral_chain_of_custody      — append-only pit-to-buyer custody log
//                                   per ore parcel; sha-256 hash-chain.
//   regulatory_filings            — calendar + status per regulator
//                                   (Mining Commission, TRA, NEMC, BoT,
//                                   BRELA, OSHA, TBS, TCRA, LHRC).
// Consumed by services/api-gateway/src/routes/ops/*.hono.ts and the
// owner brain-tools (track_parcel_chain, check_regulatory_deadline,
// lookup_counterparty, log_engagement).
export * from './external-parties.schema.js';
export * from './external-party-engagements.schema.js';
export * from './mineral-chain-of-custody.schema.js';
export * from './regulatory-filings.schema.js';

// Wave ESTATE-OS (migration 0094). Borjie runs the entire MINING
// ESTATE BUSINESS, not just one mine. The customer is a family-office
// / holdings structure where the mining licence is one asset among
// many. Five tenant-scoped tables:
//   estate_groups            — family-office shell.
//   estate_entities          — every business under the shell
//                              (mine, processing plant, transport co,
//                              fuel station, camp catering,
//                              retail-at-site, real estate, agri,
//                              forestry, tourism, JVs, ...);
//                              parent_entity_id chains support
//                              N-level subsidiary trees.
//   estate_capital_movements — intercompany money log (the ESTATE
//                              VIEW that links ledger entries to
//                              estate context). Money path STILL
//                              goes via LedgerService.post().
//   succession_plans         — multi-generational wealth-transfer
//                              plan; next_review_due_at drives
//                              reminders via the reminders worker.
//   estate_assets            — consolidated asset register across
//                              the estate.
// Consumed by services/api-gateway/src/routes/estate/*.hono.ts and
// the owner brain-tools (estate_net_worth_summary, lookup_entity,
// intercompany_flow_query, succession_review_needed,
// asset_register_browse).
export * from './estate-groups.schema.js';
export * from './estate-entities.schema.js';
export * from './estate-capital-movements.schema.js';
export * from './succession-plans.schema.js';
export * from './estate-assets.schema.js';

// ---------------------------------------------------------------------------
// Wave WORKFORCE-CLOCK-IN — biometric clock-in events (migration 0103)
// ---------------------------------------------------------------------------
//   clock_in_events — one row per (employee, clock-in instant) with
//                     biometric provider attestation + pass flag,
//                     optional geo + device. Powers the workforce-mobile
//                     expo-local-authentication flow and the owner-web
//                     WebAuthn kiosk. Read by the brain via
//                     workforce.clock_in_query / attendance_status.
export * from './clock-in-events.schema.js';

// ---------------------------------------------------------------------------
// Geo SOTA 2026-05-29 — hazard zones, workforce GPS trail, Tanzania
// regulatory zones (migration 0130_postgis). Companion docs:
// Docs/RESEARCH/GEO_SOTA_2026-05-29.md.
// ---------------------------------------------------------------------------
//   hazard_zones        — work_zone | caution | forbidden polygons per
//                          site. Drives the geofence watcher worker.
//   workforce_locations — ephemeral 24h GPS trail per worker. Read every
//                          30s by the geofence watcher.
//   regulatory_zones    — Tanzania PCCB / NEMC / EITI boundaries.
//                          Tenant-agnostic, same model as
//                          intelligence_corpus_chunks.
export * from './hazard-zones.schema.js';
export * from './workforce-locations.schema.js';
export * from './regulatory-zones.schema.js';

// ---------------------------------------------------------------------------
// Wave PRODUCTION-CAPTURE — supervisor tonnage capture (migration 0104)
// ---------------------------------------------------------------------------
//   production_tonnage_events — ore / waste split, strip ratio, source
//                                attribution, photo evidence, QA sign-off.
//                                Brain tools: mining.production.log_tonnage,
//                                daily_summary, qa_backlog.
export * from './production-tonnage.schema.js';

// ---------------------------------------------------------------------------
// Wave COOPERATIVE-SETTLEMENT — period + member distribution (migration 0105)
// ---------------------------------------------------------------------------
//   cooperative_settlement_periods   — per (cooperative, period) totals.
//   cooperative_member_distributions — per-member share + payout ref.
// Money path STILL via LedgerService.post() on distribute.
export * from './cooperative-settlements.schema.js';

// ---------------------------------------------------------------------------
// Payments-ledger money spine — accounts / ledger_entries / payment_intents
// (migration 0160). The double-entry tables behind the CLAUDE.md hard rule
// "Money path goes through LedgerService.post()". All money is INTEGER minor
// units; ledger_entries carries the idempotency_key + prev_hash/this_hash
// durability chain. RLS FORCE on app.current_tenant_id.
// ---------------------------------------------------------------------------
export * from './payments-ledger.schema.js';

// ---------------------------------------------------------------------------
// Commercial-chain settlements (migration 0131; money cols -> BIGINT minor
// units in 0131's successor 0161). One row per CoC final-step signature.
// gross/royalty/fee/net are bigint whole-TZS minor units (no float/numeric).
// ---------------------------------------------------------------------------
export * from './settlements.schema.js';

// ---------------------------------------------------------------------------
// Wave INSURANCE-BROKER — quotes + policies (migration 0106)
// ---------------------------------------------------------------------------
//   insurance_quotes   — ephemeral quote requests from broker port.
//   insurance_policies — active policies; renewal countdown indexed.
// Six coverage classes: workforce, plant, environmental, third_party,
// transit, political_risk.
export * from './insurance.schema.js';

// ---------------------------------------------------------------------------
// Wave OWNER-MESSAGING — owner-to-owner threads (migration 0107)
// ---------------------------------------------------------------------------
//   owner_threads               — subject + status (open / closed / archived).
//   owner_thread_participants   — M:N owner-thread with role.
//   owner_messages              — body_md + attachments + read receipts.
// Brain tools: owner.messaging.send_to, unread_count, thread_list.
export * from './owner-messaging.schema.js';

// ---------------------------------------------------------------------------
// Wave AGENTIC-PLATFORM — OAuth2 device flow + agent tokens (migration 0118)
// ---------------------------------------------------------------------------
//   oauth_device_codes  — short-lived pending device-flow grants.
//   oauth_agent_tokens  — per-agent access tokens, hashed at rest, scope-
//                         narrowed, tenant-scoped (RLS FORCE).
// Powers the public MCP server / CLI / SDK auth path. See
// services/api-gateway/src/routes/oauth-device.hono.ts for endpoints.
export * from './oauth-agent-tokens.schema.js';

// ---------------------------------------------------------------------------
// Wave UNWIRED-LOGIC-SWEEP-2 — schemas previously defined but missing from
// the barrel. Each schema has a backing migration AND at least one
// importing module (route, worker, or service). Without these exports
// the runtime resolution fails at boot.
// ---------------------------------------------------------------------------

// Wave SCOPE-SEGMENTATION — scope_nodes + scope_taxonomy_preferences
// (migration 0096). Consumed by /api/v1/scope/* (scope.hono.ts) and the
// md-intelligence scope-roller service.
export * from './scope-nodes.schema.js';

// Wave B-WorkerTasks — mining_tasks + mining_toolbox_talks
// (migration 0080). Consumed by /api/v1/mining/tasks and
// /api/v1/mining/toolbox-talks plus the workforce-mobile home-screen
// task queue.
export * from './mining-tasks.schema.js';

// Wave B-MgrDispatch — mining_escalations + mining_approval_items
// (migration 0081). Consumed by /api/v1/mining/escalations and
// /api/v1/mining/approvals.
export * from './mining-escalations.schema.js';

// Wave MISC-PRE-LAUNCH — mining_sic_pings (migration 0082). Consumed
// by /api/v1/mining/cockpit (sovereign-intel-cockpit telemetry).
export * from './mining-sic-pings.schema.js';
export * from './mining-sic-ping-replies.schema.js';

// Wave DOC-INTEL — document_intelligence_sessions + document_corpus_links
// (migration 0083). Consumed by /api/v1/mining/document-intelligence.
export * from './document-intelligence.schema.js';

// Wave MD-INTELLIGENCE — peer_cohort_aggregates + external_benchmarks
// (migration 0095). Consumed by the md-intelligence comparison-framework
// and the fx-feed-cron worker (writes external_benchmarks rows).
export * from './peer-cohort-benchmarks.schema.js';

// Wave UNIFIED-PERSONAL-KB — persons + person_links + personal_memory_cells
// (migration 0088). Consumed by the personal-memory recall path used by
// the brain `lookup_counterparty` tool and the persons.test integration.
export * from './persons.schema.js';
export * from './personal-memory.schema.js';

// Wave SEC-4 — agent_security tables (migration 0054). Consumed by
// `@borjie/agent-security-guard`. Backing tables for prompt-injection
// attempts, tool-use violations, output-filter blocks, generic signals,
// and red-team runs.
export * from './agent-security.schema.js';

// Wave COMPLIANCE-RESTORE — `compliance_exports` (migration 0122).
// Restored from BossNyumba archive: the Borjie compliance route surface
// (`/api/v1/compliance` + `/api/v1/compliance/exports`) still depends
// on it for TZ_TRA / KE_DPA / KE_KRA / TZ_LAND_ACT regulator-facing
// manifest rows.
export * from './compliance-exports.schema.js';

// Wave R5 closure — `help_requests` (migration 0126). Worker hero card
// "Naomba msaada" / "Need help" submissions. Surfaced to managers via
// /api/v1/field/workforce/help-requests; fan-out to the owner cockpit
// via the workforce.shift_event bus.
export * from './help-requests.schema.js';

// Roadmap R11 — buyer-initiated marketplace `request_for_bids` +
// `request_for_bid_responses` sidecar (migration 0127). Buyers post
// "I want N tonnes of X at TZS Y per unit by D"; sellers within the
// geo predicate respond. Surfaced via /api/v1/marketplace/rfb on the
// gateway and the buyer-mobile rfb-create / rfb-list screens.
export * from './request-for-bids.schema.js';

// Wave WS-2 — buyer ↔ seller bid chat / messaging (migration 0172).
// One thread per request_for_bid_responses row; append-only; RLS FORCE
// participant-aware read + tenant-locked write; idempotent send.
export * from './bid-messages.schema.js';

// Wave WS-2 — post-settlement seller ratings + reputation aggregate
// (migration 0173). One rating per ledger-backed `settlements` row;
// RLS FORCE strict tenant isolation; reputation via seller_reputation().
export * from './seller-ratings.schema.js';

// Issue #194 — regulator data-subject request (DSR) inbox
// (migration 0135). One row per regulator-originated request from
// PCCB / NEMC / EITI / TMAA. State-machine driven; pulses on the
// owner cockpit; exports redacted PDF + audit chain on approval.
export * from './regulator-requests.schema.js';

// Issue #194 — inspection narratives (migration 0136). One row per
// AI-assisted inspection report draft. State machine: draft →
// manager_ok → owner_signed → submitted → delivered. C2PA photo
// references stapled via the upstream inspection_id.
export * from './inspection-narratives.schema.js';

// Issue #207 — World-scale tenant config (migration 0143). Tenant-
// agnostic regulator-authority catalogue keyed by country + regulator
// set. Drives `tenants.regulator_set` join + per-tenant compliance
// surface. Same model as `regulatory_zones` (tenant_id = NULL).
export * from './regulator-jurisdictions.schema.js';

// R24 — inbound marketing pilot applications (migration 0146).
// Public-write surface bound to `POST /api/v1/marketing/pilot-application`,
// SUPER_ADMIN-read via the `pilot_app_select_super_admin` RLS policy.
export * from './marketing-pilot-applications.schema.js';

// Wave ROYALTY-DRAFT — `royalty_return_drafts` (migration 0159). The
// backing table for the confirm-required, NON-MONEY `draft_royalty_return`
// chat verb (sibling of draft_payroll_run / payroll_runs draft, 0134 §4).
// NO posted money / ledger column by design — gross_value / royalty_amount
// are filled by the owner in the royalty surface, NEVER from chat, and the
// royalty PAYMENT posts via LedgerService.post() on a separate four-eye flow
// (CLAUDE.md hard rule). Consumed by the action-executor
// handlers/royalty-draft.ts (draft_royalty_return).
export * from './royalty-return-drafts.schema.js';

// Wave SUPPORT-MEMORY — `support_cases` (migration 0164). Mr. Mwikila's
// PERSISTENT technical-support memory: one root-caused support/diagnosis case
// per user issue (e.g. a payment failure). `evidence_ids` proves the diagnosis
// (evidence-required). Recalled tenant+user-scoped at every brain turn so the MD
// never loses memory across sessions/devices. NO money columns — diagnosis is
// read-only; fixes route through the existing gated action-executor verbs.
// Consumed by services/api-gateway support-diagnosis + support-cases services.
export * from './support-cases.schema.js';

// Wave FEEDBACK-RESTORE — `feedback_submissions` + `complaint_records`
// (migration 0166, re-materialising the archived 0092). Backs
// services/api-gateway/src/routes/feedback.ts (POST /api/v1/feedback,
// /complaints, GET …). feedback_submissions holds both long-form survey
// feedback and the Jarvis turn-thumbs signal (type='turn-thumbs');
// complaint_records carries an open->resolved state machine. Both are
// tenant-scoped with FORCE RLS on app.current_tenant_id. NO money columns.
export * from './feedback.schema.js';

// Wave CALENDAR-SYNC — `owner_calendar_connections` (migration 0171). The
// owner's linked Google Calendar / Microsoft 365 account for the `calendar`
// reminder delivery channel. OAuth refresh/access tokens are stored ENCRYPTED
// (AES-256-GCM, key from env) — never plaintext. Mr. Mwikila reminders
// (channel='calendar') + the autonomous worker's time-bound items upsert as
// native calendar events on a stable external id (idempotent — no dupes on
// retry). Tenant+user scoped with FORCE RLS on app.current_tenant_id. Consumed
// by services/api-gateway routes/owner/calendar.hono.ts + the calendar-sync
// worker + the notification-dispatch calendar-providers adapter.
export * from './owner-calendar-connections.schema.js';

// Wave WS-4 ANALYTICS — analytics warehouses (migrations 0175/0176/0177).
// Three append-mostly read-models backing the owner-portal Analytics pages
// that previously returned X-Backend-Status: degraded:
//   analytics_usage_daily      ← audit_events feature-usage counts (0175)
//   analytics_growth_monthly   ← sites→production→sales→ledger trend (0176)
//   analytics_export_templates ← saved tenant export definitions (0177)
// Money columns are BIGINT minor units + an ISO-4217 `currency` (never a
// hardcoded TZS/USD). Tenant-scoped FORCE RLS on app.current_tenant_id.
// Consumed by services/api-gateway analytics-{usage,growth,exports}.router.ts
// + the consolidation-worker analytics-aggregate task.
export * from './analytics-warehouse.schema.js';

// Wave WS-4 BILLING — tenant_subscriptions (migration 0178). The platform's
// own SaaS revenue read-model backing GET /api/v1/billing/subscription
// (owner-portal BillingPage). State-only read-model: the actual platform-fee
// money moves through the established provider PORT (IPaymentProvider) +
// LedgerService.post(); `external_id` reconciles provider webhooks back here
// idempotently. mrr_minor_units is BIGINT minor units + ISO-4217 `currency`
// (never hardcoded). Tenant-scoped FORCE RLS on app.current_tenant_id; at most
// one active subscription per tenant. Consumed by services/api-gateway
// billing.router.ts + the PlatformBillingService adapter.
export * from './tenant-subscriptions.schema.js';

// Wave WS-3 WORKFORCE-WIRES — `leave_requests` (migration 0174). Worker-
// submitted time-off requests with a SINGLE manager approval (NO four-eye):
// pending -> approved | rejected. Mirrors the grievance flow (safety-csr →
// grievances). `worker_user_id` is the same identity payroll_line_items +
// clock-in events key on, so the worker reads/writes only their own rows.
// Every approve/reject hash-chains into ai_audit_chain at the route layer.
// Tenant-scoped FORCE RLS on app.current_tenant_id. NO money columns. Consumed
// by services/api-gateway routes/mining/leave-requests.hono.ts + the
// workforce-mobile (worker) leave screen.
export * from './leave-requests.schema.js';

// payroll_runs + payroll_line_items (migration 0134). The payroll chain L-B
// tables behind the owner payroll route AND the WS-3 worker payslip read.
// This schema file existed on disk but was NOT reachable from the barrel, so
// `import { payrollRuns, payrollLineItems } from '@borjie/database'` resolved
// to `undefined` at runtime under the source alias (only the built dist masked
// it). Export it here so both the owner payroll route and the worker payslip
// route bind the real Drizzle tables. RLS FORCE on app.current_tenant_id;
// money path STILL goes through LedgerService.post() (these are read/commit
// surfaces, never a direct ledger write).
export * from './payroll-runs.schema.js';

// contractor_damage_claims + site_rehabilitation_plans +
// rehabilitation_action_plans (migration 0279). Ported from the BN dispute /
// damage-deduction + conditional-survey stack, retargeted real-estate ->
// mining: a licence holder files a damage claim against a contractor for site
// damage, negotiates (respond), then settles (settle) an agreed amount as
// STATE (no ledger posting); rehabilitation plans + action plans drive the
// approve_plan flow. Amounts in minor units + explicit currency. Tenant-scoped
// FORCE RLS on app.current_tenant_id. Consumed by routes/damage-claims.hono.ts
// + the site.damage_claim.* / site.rehabilitation.approve_plan brain tools.
export * from './site-damage-settlement.schema.js';

// staff_members + staff_kpis + org_tasks + org_escalations (migration 0280).
// Org / team-management write surface ported from the BN org/team stack
// (itself a LitFin iter-27..31 port), retargeted real-estate -> mining: a
// mining operator hires a staff member (site_supervisor / pit_foreman /
// safety_officer / geologist / accountant), assigns a KPI, schedules a task,
// or escalates to a human (compliance_breach / safety_incident /
// payment_default). KPI metric units are currency-neutral. Tenant-scoped
// FORCE RLS on app.current_tenant_id. Consumed by routes/org-admin.hono.ts +
// the staff.* brain tools.
export * from './org-team-management.schema.js';

// md_plans + md_subagent_runs + md_sandbox_writes + md_sandbox_commits +
// md_sandbox_rejects (migration 0281). Agentic plan / subagent + sandbox-
// preview surface ported from the BN md-agentic stack (itself a LitFin
// iter-32 plan-mode + iter-36 agent-teams / sandbox-writes port), retargeted
// real-estate -> mining: Claude-Code-parity plan mode + agent teams + a
// worktree-style sandbox where the brain STAGES a mutation against the gap-2
// org/team tables, the owner reviews, then commits (atomic write + audit) or
// rejects. Subagent dispatch is honest-degraded (persists pending runs, never
// fabricates results). Tenant-scoped FORCE RLS on app.current_tenant_id.
// Consumed by routes/md-agentic.hono.ts + the plan.* / sandbox.* brain tools.
export * from './md-agentic.schema.js';

// owner_style_profiles (migration 0282). Wave OWNER-STYLE / gap-8. One
// tenant-scoped row capturing HOW Mr. Mwikila should speak to each mining
// owner — verbosity / detail / language / formality / posture — learned online
// via a Bayesian feedback loop (decay 0.98 + reaction-boost). Headline category
// + per-dimension confidence in typed columns; the full Dirichlet posterior in
// profile_json. tenant_id TEXT, FORCE RLS on app.current_tenant_id. Backs the
// OwnerStyleProfileStore port (createPgOwnerStyleProfileStore) consumed by the
// @borjie/ai-copilot orchestrator's owner-style seam. Ported from the BN
// owner_style_profiles table.
export * from './owner-style.schema.js';

// training scenarios + learning progress (migration 0283). Wave
// TRAINING-DELIVERY / gaps 9+10+13. Three tenant-scoped tables backing the
// owner-cockpit rehearsal surfaces: `scenarios` (one generated template per
// kind, built deterministically from the concept catalog — never fabricated),
// `scenario_sessions` (append-only learner-run transcript + per-concept
// coverage), and `learning_progress` (per (tenant, user, concept) BKT mastery
// snapshot; a 0.7 pass gates the next phase). Mining scenario kinds:
// licence_renewal_negotiation / royalty_dispute / safety_incident_triage /
// offtake_negotiation / contractor_damage_claim. tenant_id TEXT, FORCE RLS on
// app.current_tenant_id. Backs routes/scenarios.hono.ts +
// composition/scenario-repository.ts. Ported from the BN training-scenarios
// stack, retargeted real-estate → mining.
export * from './training-scenarios.schema.js';

// AI-generated mining courses (migration 0284). Wave COURSE-GEN / gap 11.
// Three tenant-scoped tables backing the owner-cockpit create-course surface:
// `courses` (one generated course per operator request; the validated
// curriculum snapshot lives in ai_generated_curriculum jsonb; generated_via
// records 'llm' | 'deterministic' — honest-degrade, never fabricated),
// `course_lessons` (normalised per-lesson rows), and `course_documents` (the
// grounding documents the learner attached). tenant_id TEXT, FORCE RLS on
// app.current_tenant_id; every row also carries created_by_user_id for
// defence-in-depth owner scoping. Backs services/courses/* +
// routes/courses.hono.ts. Ported from the BN course-gen stack, retargeted
// real-estate → mining.
export * from './courses.schema.js';

// AI-native (Agent PhL) durable persistence (migrations 0287-0289). Three
// tenant-scoped tables that make the dynamic-pricing / doc-intelligence /
// legal-drafter capabilities durable (they previously persisted only to an
// in-process map because the tables lived in the BossNyumba .archive tree):
//   - price_recommendations (0287) — one `proposed` mineral-price proposal per
//     row; money as minor-units + ISO-4217 currency_code (never a literal).
//   - document_entities + document_obligations (0288) — extracted entities and
//     obligations per uploaded document, each citing a char span.
//   - legal_drafts (0289) — first-draft mining-contract documents; the DB
//     FORCE-enforces the licence_suspension_notice must-review invariant.
// All FORCE RLS on app.current_tenant_id. Backed by the api-gateway
// composition root's ai-native/drizzle-repos.ts + ai-native-wiring.ts.
export * from './ai-native-pricing.schema.js';
export * from './ai-native-document-intelligence.schema.js';
export * from './ai-native-legal-drafts.schema.js';

// Mining ADVISOR wave — inventory + procurement domain tables.
//   - inventory-management (0292) — `inventory_skus` (consumable/spare/PPE/fuel
//     catalog with reorder thresholds) + `inventory_stock_movements`
//     (append-only receipt/issue/adjust ledger). Backs routes/mining/
//     inventory.hono.ts via composition/inventory/drizzle-inventory-store.ts.
//   - procurement-coordination (0294) — vendor master + KYC docs, budgets,
//     requisitions, approval chains/policies, purchase orders + PO sequences,
//     and vendor invoices. Backs routes/mining/procurement-coordination.hono.ts
//     via composition/procurement/drizzle-data-port.ts.
// All FORCE RLS on app.current_tenant_id.
export * from './inventory-management.schema.js';
export * from './procurement-coordination.schema.js';

// Mining ADVISOR wave — stage-advisor durable store (migration 0295).
//   - stage_advisor_metrics / _org_state / _state — per-tenant latest snapshots
//     + persisted hysteresis state for the seven-stage lifecycle classifier.
//   - stage_advisor_nudges (append-only delivery log) + _nudge_dismissals
//     (sticky suppression) — back the proactive-nudge idempotency + dismissal.
//   - stage_advisor_transitions (append-only) — backs GET /api/v1/stage/history.
// All FORCE RLS on app.current_tenant_id. Backed by the api-gateway composition
// root's stage/drizzle-stage-advisor-db.ts → routes/stage/index.ts.
export * from './stage-advisor.schema.js';

// FINAL NEEDS-DESIGN wave — knowledge-graph, conformal calibration, admin
// analytics, MCP cost persistence, agent memory.
//   - knowledge-graph (0298) — `kg_nodes` (entity/corpus_chunk nodes, reuses the
//     existing pgvector corpus embedding) + `kg_edges` (typed relationships).
//     Backs GraphRAG 1–2 hop neighborhood expansion in chat-orchestrator via
//     composition/knowledge-graph/{postgres-kg-store,ingest}.ts.
//   - conformal-calibration (0299) — `conformal_predictions` (interval +
//     alpha_at_emit) + `conformal_observations` (covered bool) +
//     `conformal_calibration_state` (persisted online-ACI alpha). Backs the
//     prediction→outcome coverage-feedback loop via composition/conformal/*.
//   - admin-analytics (0300) — `ab_experiments` (platform/HQ, route-gated) +
//     `activation_events` (tenant-scoped product funnel) + `audit_packs`
//     (regulator bundles). Backs routes/mining/internal/{analytics,ab-tests,
//     audit-pack}.hono.ts + services/activation-events/record-activation-event.
//   - mcp-cost-persistence (0301) — `mcp_cost_ledger` (per-tenant/server/tool
//     token+usd spend). Backs composition/mcp/persistent-mcp-cost-ledger.ts
//     (replaces the restart-volatile in-memory MCP cost counter).
//   - agent-memory (0302) — `agent_memory` (jsonb working-notebook, UNIQUE
//     tenant+agent+key upsert). Backs composition/memory/drizzle-memory-tool.ts
//     (Anthropic memory_20250818 tool + mwikila.memory.* persona tools).
// All tenant-scoped tables FORCE RLS on app.current_tenant_id (ab_experiments is
// platform/HQ — route-gated, no RLS policy).
export * from './knowledge-graph.schema.js';
export * from './conformal-calibration.schema.js';
export * from './admin-analytics.schema.js';
export * from './mcp-cost-ledger.schema.js';
export * from './agent-memory.schema.js';

// device_push_tokens (migration 0139) — typed Drizzle handle on the
// EXISTING push-notification token registry (no new table). Backs the
// `app_push` channel fan-out: resolve a user's active `expo_push_token`
// rows + hand each to the Expo push provider (services/api-gateway/src/
// services/notification-dispatch/push-provider.ts). tenant_id is uuid
// (pre-dates the text-tenant convention); FORCE RLS per migration 0139.
export * from './device-push-tokens.schema.js';

// workflow_registry (migration 0316) — the persisted, embeddable flow
// catalog the modality arbiter (COG-07/AUT-14) retrieves over. Adds
// `trigger_embedding VECTOR(1536)` so a turn intent can nearest-neighbour a
// flow's trigger description; `loop_kind` distinguishes a bounded workflow
// (workflow-engine) from a standing loop (@borjie/loop-runner). tenant_id
// NULL ⇒ global flow; FORCE RLS on app.current_tenant_id + service-role
// bypass per migration 0316.
export * from './workflow-registry.schema.js';
