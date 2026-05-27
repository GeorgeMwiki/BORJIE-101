/**
 * Intel Self-Improve Wiring persistence (Wave INTEL-SELF-IMPROVE).
 *
 * Companion to Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 * Drizzle types for the two tables created by migration
 * 0072_intel_self_improve.sql:
 *
 *   - intelInvocationAudit → one row per measured intel call (forecast |
 *                            stat | graph_db | causal | anomaly |
 *                            recommendation). The outcome-observer cron
 *                            fills observation columns once the
 *                            measurement horizon elapses.
 *
 *   - intelSkillTraces     → per-(tenant, intel_kind, pattern_signature)
 *                            success/failure counter — Voyager-style
 *                            skill library (Wang et al. arXiv 2305.16291).
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy. Both
 * tables carry prev_hash + audit_hash for tamper-evident replay against
 * the per-tenant chain.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// intel_invocation_audit — per-call detail row
// ============================================================================

export const intelInvocationAudit = pgTable(
  'intel_invocation_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** FK alignment with `capabilities.id` from the catalogue. */
    capabilityId: uuid('capability_id').notNull(),
    /** One of: forecast | stat | graph_db | causal | anomaly | recommendation. */
    intelKind: text('intel_kind').notNull(),
    /** Canonical JSON projection of the call inputs (post-redaction). */
    inputPayload: jsonb('input_payload').notNull(),
    /** Canonical JSON projection of the call outputs. */
    outputPayload: jsonb('output_payload').notNull(),
    /** Confidence the underlying model claims in its output. [0,1]. */
    claimedConfidence: doublePrecision('claimed_confidence')
      .notNull()
      .default(0),
    /** Wall-clock latency from invocation to result (ms). */
    latencyMs: integer('latency_ms').notNull().default(0),
    /** Cost in US cents. */
    costUsdCents: integer('cost_usd_cents').notNull().default(0),
    /** Filled by the outcome-observer cron — null until horizon reached. */
    observedOutcome: text('observed_outcome'),
    /** Filled by the outcome-observer cron — null until horizon reached. */
    userFollowthrough: text('user_followthrough'),
    /** Free-form ground-truth attachment, e.g. observed forecast value. */
    observationPayload: jsonb('observation_payload'),
    invokedAt: timestamp('invoked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantKindInvokedIdx: index(
      'idx_intel_invocation_audit_tenant_kind_invoked',
    ).on(t.tenantId, t.intelKind, t.invokedAt),
    capabilityIdx: index('idx_intel_invocation_audit_capability').on(
      t.tenantId,
      t.capabilityId,
      t.invokedAt,
    ),
    auditHashIdx: index('idx_intel_invocation_audit_audit_hash').on(
      t.auditHash,
    ),
  }),
);

export type IntelInvocationAuditRow =
  typeof intelInvocationAudit.$inferSelect;
export type IntelInvocationAuditInsert =
  typeof intelInvocationAudit.$inferInsert;

// ============================================================================
// intel_skill_traces — per-pattern counters
// ============================================================================

export const intelSkillTraces = pgTable(
  'intel_skill_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    intelKind: text('intel_kind').notNull(),
    /** sha256 over canonical-json of the call inputs. */
    patternSignature: text('pattern_signature').notNull(),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastCapabilityId: uuid('last_capability_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    patternUnique: uniqueIndex('uq_intel_skill_traces_pattern').on(
      t.tenantId,
      t.intelKind,
      t.patternSignature,
    ),
    tenantKindLastIdx: index('idx_intel_skill_traces_tenant_kind_last').on(
      t.tenantId,
      t.intelKind,
      t.lastSeenAt,
    ),
    auditHashIdx: index('idx_intel_skill_traces_audit_hash').on(
      t.auditHash,
    ),
  }),
);

export type IntelSkillTraceRow = typeof intelSkillTraces.$inferSelect;
export type IntelSkillTraceInsert = typeof intelSkillTraces.$inferInsert;
