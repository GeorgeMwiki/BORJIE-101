/**
 * Training-scenarios / learning-progress schema (migration 0283).
 *
 * Borjie's mining operators learn the job by REHEARSING it: a licence-renewal
 * negotiation, a royalty dispute, a safety-incident triage, an offtake
 * negotiation, a contractor-damage claim. This schema backs the
 * scenario-simulation surface (owner-web /training/scenarios) and the
 * mastery-checkpoint surface (owner-web /training/checkpoint).
 *
 * Companion to:
 *   - packages/database/src/migrations/0283_training_scenarios_progress.sql
 *   - services/api-gateway/src/routes/scenarios.hono.ts
 *   - packages/ai-copilot/src/training/scenario-generator.ts
 *
 * Three tables:
 *   - scenarios          one row per generated scenario template (built
 *                        deterministically from the concept catalog — NEVER
 *                        fabricated content; a row records WHICH concepts +
 *                        which kind produced it).
 *   - scenario_sessions  one row per learner run of a scenario (turns +
 *                        per-concept coverage are appended, never mutated in
 *                        place; the row is the durable transcript).
 *   - learning_progress  per (tenant, user, concept) mastery snapshot fed by
 *                        checkpoint results. Append-or-upsert; a 0.7 pass
 *                        gates the next phase.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors org-team-management.schema /
 * migration 0280): tenant_id is TEXT; `app.current_tenant_id` GUC RLS,
 * FORCE-enabled, bound by the api-gateway databaseMiddleware. Every query the
 * route runs is also tenant-filtered defensively. NEVER the legacy
 * app.tenant_id.
 *
 * Currency-neutral (CLAUDE.md hard rule): NOTHING here hard-codes a
 * jurisdiction currency. Scenario money figures live inside the jsonb
 * `briefing` payload as plain numbers; the surface formats them with
 * formatCurrency at render time.
 *
 * Ported from the BossNyumba training-scenarios schema and retargeted
 * real-estate → mining. Mirrors the org-team-management.schema.ts pattern:
 * uuid PK, TEXT tenant_id (no FK — RLS owns isolation), enum value catalogs
 * paired with CHECK constraints, provenance jsonb, audit_hash_id.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── enum value catalogs (mirrored as CHECK constraints in mig 0283) ────────

/**
 * Scenario kinds — mining-domain retarget of the BN estate scenario types.
 * Each maps to a junior role-mode the operator is rehearsing.
 */
export const SCENARIO_KINDS = [
  'licence_renewal_negotiation',
  'royalty_dispute',
  'safety_incident_triage',
  'offtake_negotiation',
  'contractor_damage_claim',
] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

/** Scenario difficulty — mirrors the concept catalog difficulty ladder. */
export const SCENARIO_DIFFICULTIES = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
export type ScenarioDifficulty = (typeof SCENARIO_DIFFICULTIES)[number];

/** Scenario lifecycle. */
export const SCENARIO_STATUSES = ['active', 'archived'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** Scenario session lifecycle. */
export const SCENARIO_SESSION_STATUSES = [
  'in_progress',
  'completed',
  'abandoned',
] as const;
export type ScenarioSessionStatus = (typeof SCENARIO_SESSION_STATUSES)[number];

// ── scenarios ──────────────────────────────────────────────────────────────

export const scenarios = pgTable(
  'scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Scenario kind (licence_renewal_negotiation / royalty_dispute / …). */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    titleSw: text('title_sw'),
    summary: text('summary').notNull(),
    summarySw: text('summary_sw'),
    difficulty: text('difficulty').notNull().default('beginner'),
    language: text('language').notNull().default('en'),
    /** Concept ids (from the concept catalog) this scenario rehearses. */
    conceptIds: jsonb('concept_ids').notNull().default([]),
    /**
     * Generated briefing payload (counterparty profile, objectives, hidden
     * risks, rubric). Built deterministically from the catalog — never
     * fabricated. Plain numbers only; no jurisdiction currency code.
     */
    briefing: jsonb('briefing').notNull().default({}),
    estimatedMinutes: integer('estimated_minutes').notNull().default(10),
    status: text('status').notNull().default('active'),
    generatedBy: text('generated_by').notNull().default('concept_catalog'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKindIdx: index('scenarios_tenant_kind').on(
      table.tenantId,
      table.kind,
      table.status,
    ),
    tenantStatusIdx: index('scenarios_tenant_status').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    tenantKindDifficultyUq: uniqueIndex('scenarios_tenant_kind_difficulty_uq').on(
      table.tenantId,
      table.kind,
      table.difficulty,
      table.language,
    ),
  }),
);

export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;

// ── scenario_sessions ────────────────────────────────────────────────────

export const scenarioSessions = pgTable(
  'scenario_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    /** Learner — derived server-side from the verified JWT, never client-sent. */
    userId: text('user_id').notNull(),
    /** Admin-locked role-mode the learner is rehearsing (validated server-side). */
    roleMode: text('role_mode').notNull(),
    status: text('status').notNull().default('in_progress'),
    /** Append-only transcript turns (learner question + counterparty reply). */
    turns: jsonb('turns').notNull().default([]),
    /** Per-concept coverage flags accumulated across the run. */
    coverage: jsonb('coverage').notNull().default({}),
    score: doublePrecision('score'),
    feedback: jsonb('feedback').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantUserIdx: index('scenario_sessions_tenant_user').on(
      table.tenantId,
      table.userId,
      table.status,
    ),
    scenarioIdx: index('scenario_sessions_scenario').on(
      table.tenantId,
      table.scenarioId,
      table.startedAt,
    ),
  }),
);

export type ScenarioSession = typeof scenarioSessions.$inferSelect;
export type NewScenarioSession = typeof scenarioSessions.$inferInsert;

// ── learning_progress ──────────────────────────────────────────────────────

export const learningProgress = pgTable(
  'learning_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    conceptId: text('concept_id').notNull(),
    /** Probability-of-knowledge in [0, 1] from checkpoint results. */
    pKnow: doublePrecision('p_know').notNull().default(0),
    /** Attempts seen for this concept (checkpoint + scenario coverage). */
    attempts: integer('attempts').notNull().default(0),
    /** Correct answers for this concept. */
    correct: integer('correct').notNull().default(0),
    /** Whether the learner cleared the 0.7 mastery gate for this concept. */
    mastered: text('mastered').notNull().default('no'),
    source: text('source').notNull().default('checkpoint'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantUserConceptUq: uniqueIndex('learning_progress_tenant_user_concept_uq').on(
      table.tenantId,
      table.userId,
      table.conceptId,
    ),
    tenantUserIdx: index('learning_progress_tenant_user').on(
      table.tenantId,
      table.userId,
      table.lastSeenAt,
    ),
  }),
);

export type LearningProgress = typeof learningProgress.$inferSelect;
export type NewLearningProgress = typeof learningProgress.$inferInsert;
