/**
 * Mining workforce + marketplace extensions — Borjie hard-fork wave 6.
 *
 * Five tenant-scoped tables that replace the property-domain
 * (waitlist / gamification / conditional-survey / station-master-coverage /
 * maintenance-taxonomy) repositories with mining-domain equivalents:
 *
 *   1. worker_incentives             — safety badges / productivity rewards
 *   2. equipment_maintenance_taxonomy — per-equipment-kind problem catalog
 *   3. offtake_queue                 — buyers waiting for parcels
 *   4. site_supervisor_coverage      — who supervises which site/shift
 *   5. pre_shift_inspections         — daily pre-shift safety checklist
 *
 * Tenant isolation enforced via tenant_id on every row + RLS policies
 * installed by migration 0007.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { sites } from './sites.schema.js';
import { assets } from './assets-fleet.schema.js';
import { buyers } from './production-sales.schema.js';

// ============================================================================
// 1. worker_incentives — safety badges, productivity rewards
// ============================================================================

export const workerIncentives = pgTable(
  'worker_incentives',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** safety_badge|productivity_reward|attendance_streak|incident_free_days|other. */
    kind: text('kind').notNull(),
    points: integer('points').notNull().default(0),
    /** Human-readable reason (e.g. "30 days incident-free", "Hit production target"). */
    reason: text('reason'),
    /** Per-incentive metadata (e.g. streak length, target met). */
    metadata: jsonb('metadata').notNull().default({}),
    awardedAt: timestamp('awarded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    awardedByUserId: text('awarded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('worker_incentives_tenant_idx').on(t.tenantId),
    userIdx: index('worker_incentives_user_idx').on(t.tenantId, t.userId),
    kindIdx: index('worker_incentives_kind_idx').on(t.tenantId, t.kind),
    awardedAtIdx: index('worker_incentives_awarded_at_idx').on(
      t.tenantId,
      t.awardedAt,
    ),
  }),
);

// ============================================================================
// 2. equipment_maintenance_taxonomy — per-equipment-kind problem catalog
// ============================================================================

export const equipmentMaintenanceTaxonomy = pgTable(
  'equipment_maintenance_taxonomy',
  {
    id: text('id').primaryKey(),
    /** NULL = platform default; non-NULL = tenant override. */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Mirrors `assets.kind` (excavator|compressor|generator|pump|crusher|truck|vehicle|drill_rig|tool|ppe). */
    equipmentKind: text('equipment_kind').notNull(),
    /** Stable slug — uniquely identifies the row inside a (tenantId, equipmentKind). */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /**
     * [{ code, name, defaultSeverity, evidenceRequired }] — possible problems
     * for this equipment kind. Kept as jsonb so categories evolve without
     * a migration.
     */
    problemCategories: jsonb('problem_categories').notNull().default([]),
    /** Default SLA window (hours from `open` -> `completed`). */
    slaHours: integer('sla_hours').notNull().default(72),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('equipment_maintenance_taxonomy_tenant_idx').on(
      t.tenantId,
    ),
    kindIdx: index('equipment_maintenance_taxonomy_kind_idx').on(
      t.tenantId,
      t.equipmentKind,
    ),
    codeIdx: uniqueIndex('equipment_maintenance_taxonomy_code_idx').on(
      t.tenantId,
      t.equipmentKind,
      t.code,
    ),
  }),
);

// ============================================================================
// 3. offtake_queue — buyers waiting for parcels
// ============================================================================

export const offtakeQueue = pgTable(
  'offtake_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    /** e.g. 'gold', 'tanzanite', 'tin', 'coltan'. */
    mineral: text('mineral').notNull(),
    requestedQuantityKg: numeric('requested_quantity_kg', {
      precision: 12,
      scale: 3,
    }).notNull(),
    maxPriceTzs: numeric('max_price_tzs', { precision: 18, scale: 2 }),
    /** waiting|matched|fulfilled|expired|cancelled. */
    status: text('status').notNull().default('waiting'),
    /** Routing priority (1 = highest). Hand-set by ops or derived. */
    priority: integer('priority').notNull().default(100),
    /** Free-form filters (grade band, refinery requirement, etc.). */
    filters: jsonb('filters').notNull().default({}),
    matchedParcelId: text('matched_parcel_id'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('offtake_queue_tenant_idx').on(t.tenantId),
    buyerIdx: index('offtake_queue_buyer_idx').on(t.tenantId, t.buyerId),
    statusIdx: index('offtake_queue_status_idx').on(
      t.tenantId,
      t.status,
      t.priority,
    ),
    mineralIdx: index('offtake_queue_mineral_idx').on(t.tenantId, t.mineral),
  }),
);

// ============================================================================
// 4. site_supervisor_coverage — who supervises which site/shift
// ============================================================================

export const siteSupervisorCoverage = pgTable(
  'site_supervisor_coverage',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    supervisorUserId: text('supervisor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** day|night|all. */
    shiftKind: text('shift_kind').notNull().default('day'),
    validFrom: timestamp('valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    /** Free-form (deputies, alternate contact). */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('site_supervisor_coverage_tenant_idx').on(t.tenantId),
    siteIdx: index('site_supervisor_coverage_site_idx').on(t.tenantId, t.siteId),
    supervisorIdx: index('site_supervisor_coverage_supervisor_idx').on(
      t.tenantId,
      t.supervisorUserId,
    ),
    activeIdx: index('site_supervisor_coverage_active_idx').on(
      t.tenantId,
      t.siteId,
      t.shiftKind,
      t.validTo,
    ),
  }),
);

// ============================================================================
// 5. pre_shift_inspections — daily pre-shift safety checklist
// ============================================================================

export const preShiftInspections = pgTable(
  'pre_shift_inspections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Drill rig / excavator / generator / pump etc. — required. */
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    supervisorUserId: text('supervisor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** day|night. */
    shiftKind: text('shift_kind').notNull().default('day'),
    /**
     * [{ code, label, status: 'pass'|'fail'|'na', note? }] — the checklist
     * items + their per-item verdict. Append-only on insert.
     */
    checklist: jsonb('checklist').notNull().default([]),
    /** pending|passed|failed|sign_off_pending. */
    overallStatus: text('overall_status').notNull().default('pending'),
    signOffUserId: text('sign_off_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    signOffAt: timestamp('sign_off_at', { withTimezone: true }),
    /** Failure notes, blocker tickets. */
    notes: text('notes'),
    /** Photo / evidence URIs (S3 keys). */
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('pre_shift_inspections_tenant_idx').on(t.tenantId),
    siteIdx: index('pre_shift_inspections_site_idx').on(t.tenantId, t.siteId),
    assetIdx: index('pre_shift_inspections_asset_idx').on(
      t.tenantId,
      t.assetId,
    ),
    statusIdx: index('pre_shift_inspections_status_idx').on(
      t.tenantId,
      t.overallStatus,
    ),
  }),
);

// ============================================================================
// Type re-exports
// ============================================================================

export type WorkerIncentive = typeof workerIncentives.$inferSelect;
export type NewWorkerIncentive = typeof workerIncentives.$inferInsert;

export type EquipmentMaintenanceTaxonomyRow =
  typeof equipmentMaintenanceTaxonomy.$inferSelect;
export type NewEquipmentMaintenanceTaxonomyRow =
  typeof equipmentMaintenanceTaxonomy.$inferInsert;

export type OfftakeQueueEntry = typeof offtakeQueue.$inferSelect;
export type NewOfftakeQueueEntry = typeof offtakeQueue.$inferInsert;

export type SiteSupervisorCoverageRow =
  typeof siteSupervisorCoverage.$inferSelect;
export type NewSiteSupervisorCoverageRow =
  typeof siteSupervisorCoverage.$inferInsert;

export type PreShiftInspectionRow = typeof preShiftInspections.$inferSelect;
export type NewPreShiftInspectionRow = typeof preShiftInspections.$inferInsert;
