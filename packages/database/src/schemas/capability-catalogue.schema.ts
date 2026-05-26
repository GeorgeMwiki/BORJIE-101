/**
 * Capability Catalogue persistence (Wave CAPABILITY).
 *
 * Companion to `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md`. Drizzle types
 * for the four tables created by migration 0045_capability_catalogue.sql:
 *
 *   - capabilities             → the registry itself. UNIQUE
 *                                 (tenant_id, name, version). Seed
 *                                 capabilities use tenant_id = '__seed__'.
 *
 *   - capabilityInvocations    → one row per call. Powers competence.
 *
 *   - capabilityOutcomes       → one row per resolved outcome (FK to
 *                                 invocation). Powers calibration + utility.
 *
 *   - capabilityMeasurements   → one row per (capability, window) per
 *                                 measurement tick. Powers lifecycle.
 *
 * All four tables are tenant-scoped via the canonical `app.tenant_id`
 * GUC RLS policy from migration 0003. Seed capabilities (`__seed__`)
 * are additionally visible cross-tenant on SELECT.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// capabilities — the registry
// ============================================================================

export const capabilities = pgTable(
  'capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** '__seed__' for platform-wide seeds; tenant id otherwise. */
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    /** atomic | meta | tenant. */
    kind: text('kind').notNull(),
    /** 'platform' | 'tenant:<id>' | 'junior:<id>'. */
    owner: text('owner').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    lifecycleState: text('lifecycle_state').notNull().default('draft'),
    /** Other capability ids this capability depends on. */
    dependencies: text('dependencies')
      .array()
      .notNull()
      .default([]),
    /** Zod-encoded I/O contract plus cost + latency budgets. */
    contract: jsonb('contract').notNull(),
    /** seed | spawned | tenant_authored. */
    provenanceClass: text('provenance_class').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash'),
  },
  (t) => ({
    tenantNameVersionUniq: unique(
      'capabilities_tenant_name_version_uniq',
    ).on(t.tenantId, t.name, t.version),
    tenantLifecycleIdx: index('idx_capabilities_tenant_lifecycle').on(
      t.tenantId,
      t.lifecycleState,
    ),
    tenantKindIdx: index('idx_capabilities_tenant_kind').on(
      t.tenantId,
      t.kind,
    ),
    nameIdx: index('idx_capabilities_name').on(t.name, t.version),
    auditHashIdx: index('idx_capabilities_audit_hash').on(t.auditHash),
  }),
);

export type CapabilityRow = typeof capabilities.$inferSelect;
export type CapabilityInsertRow = typeof capabilities.$inferInsert;

// ============================================================================
// capability_invocations — one row per call (powers competence)
// ============================================================================

export const capabilityInvocations = pgTable(
  'capability_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    capabilityId: uuid('capability_id').notNull(),
    invokedAt: timestamp('invoked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    latencyMs: integer('latency_ms').notNull().default(0),
    success: boolean('success').notNull(),
    errorKind: text('error_kind'),
    costUsdCents: integer('cost_usd_cents').notNull().default(0),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantCapabilityTimeIdx: index(
      'idx_cap_invocations_tenant_capability_time',
    ).on(t.tenantId, t.capabilityId, t.invokedAt),
    capabilityTimeIdx: index('idx_cap_invocations_capability_time').on(
      t.capabilityId,
      t.invokedAt,
    ),
    auditHashIdx: index('idx_cap_invocations_audit_hash').on(t.auditHash),
  }),
);

export type CapabilityInvocationRow = typeof capabilityInvocations.$inferSelect;
export type CapabilityInvocationInsertRow =
  typeof capabilityInvocations.$inferInsert;

// ============================================================================
// capability_outcomes — one row per resolved outcome (calibration + utility)
// ============================================================================

export const capabilityOutcomes = pgTable(
  'capability_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invocationId: uuid('invocation_id').notNull(),
    /** [0, 1]. */
    claimedConfidence: real('claimed_confidence').notNull(),
    /** confirmed | disconfirmed | partial | unknown. */
    observedOutcome: text('observed_outcome').notNull(),
    /** accepted | modified | rejected | ignored. */
    userFollowthrough: text('user_followthrough').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    invocationIdx: index('idx_cap_outcomes_invocation').on(t.invocationId),
    recordedIdx: index('idx_cap_outcomes_recorded').on(t.recordedAt),
    auditHashIdx: index('idx_cap_outcomes_audit_hash').on(t.auditHash),
  }),
);

export type CapabilityOutcomeRow = typeof capabilityOutcomes.$inferSelect;
export type CapabilityOutcomeInsertRow =
  typeof capabilityOutcomes.$inferInsert;

// ============================================================================
// capability_measurements — one row per (capability, window) per tick
// ============================================================================

export const capabilityMeasurements = pgTable(
  'capability_measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    capabilityId: uuid('capability_id').notNull(),
    /** 7 | 28 | 91. */
    windowDays: integer('window_days').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** [0, 1]. */
    competenceRate: real('competence_rate').notNull(),
    /** [0, 1]. 0 = perfect calibration. */
    calibrationError: real('calibration_error').notNull(),
    /** [0, 1]. */
    utilityRate: real('utility_rate').notNull(),
    nObservations: integer('n_observations').notNull(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantCapabilityWindowIdx: index(
      'idx_cap_measurements_tenant_capability_window',
    ).on(t.tenantId, t.capabilityId, t.windowDays, t.measuredAt),
    capabilityWindowIdx: index('idx_cap_measurements_capability_window').on(
      t.capabilityId,
      t.windowDays,
      t.measuredAt,
    ),
    auditHashIdx: index('idx_cap_measurements_audit_hash').on(t.auditHash),
  }),
);

export type CapabilityMeasurementRow =
  typeof capabilityMeasurements.$inferSelect;
export type CapabilityMeasurementInsertRow =
  typeof capabilityMeasurements.$inferInsert;
