/**
 * Portal layouts — per-user UI document store.
 *
 * Migration 0164. Backs the `PortalLayout` Zod schema in
 * `@borjie/genui/document.ts` so each (tenant, persona, user)
 * can have a persisted UI shape — the data substrate behind the
 * "dynamic per-user UI" pattern researched in
 * `.audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md`.
 *
 * Storage model
 * -------------
 * - One row per (tenantId, personaId, userId-or-null). `userId` NULL
 *   means a tenant-default layout that any user matching the persona
 *   inherits from until they fork their own.
 * - `layout` is a JSONB blob containing the full `PortalLayout`
 *   document. We keep the typed columns (tenantId, personaId, userId,
 *   version, parentLayoutId, createdAt, updatedAt) outside the JSONB
 *   so indexes and FKs work without GIN extractors.
 * - `parentLayoutId` lets us model fork lineage (user-edits-from
 *   tenant-default; tenant-default-edits-from platform seed). NULL
 *   means root (forked directly from a static persona seed).
 *
 * Resolution order — the gateway route resolves these in order:
 *   1. (tenantId, personaId, userId) — the user's own layout
 *   2. (tenantId, personaId, userId=NULL) — tenant default
 *   3. The static seed under `@borjie/genui/seeds/`
 *   4. The platform default seed
 *
 * RLS is enforced via migration 0164 (mirrors the 0155/0156/0163
 * pattern). The application layer ALSO scopes by tenantId/userId so
 * a missed RLS rebind degrades to "no rows" rather than cross-tenant
 * read.
 */

import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenant.schema.js';

export const portalLayouts = pgTable(
  'portal_layouts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * Persona key — matches the TRC seed roles
     * (`internal_admin` | `property_manager` | `estate_manager` |
     * `owner` | `customer`). CHECK constraint in migration 0164.
     */
    personaId: text('persona_id').notNull(),
    /**
     * NULL means tenant-default for this persona. Non-NULL means a
     * user-specific override. The unique index on
     * (tenant_id, persona_id, COALESCE(user_id, '')) keeps only one
     * tenant-default and one per-user row.
     */
    userId: text('user_id'),
    /** PortalLayout schema version — currently 1. */
    schemaVersion: integer('schema_version').notNull().default(1),
    /** Whole `PortalLayout` document as JSON. Validated client + server side. */
    layout: jsonb('layout').notNull(),
    /** Parent doc this was forked from, for lineage. */
    parentLayoutId: text('parent_layout_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Composite resolution lookup — the hot path. */
    tenantPersonaUserIdx: index('idx_portal_layouts_tenant_persona_user').on(
      t.tenantId,
      t.personaId,
      t.userId,
    ),
    /**
     * Uniqueness — one row per (tenant, persona, user). NULL user is
     * a distinct "tenant default" slot; we enforce single-default via
     * the partial unique index defined in migration 0164 (Drizzle 0.36
     * lacks first-class partial-index DDL, so the migration ships the
     * raw SQL).
     */
    tenantPersonaUserUq: uniqueIndex('uq_portal_layouts_tenant_persona_user').on(
      t.tenantId,
      t.personaId,
      t.userId,
    ),
    /** Parent lookup for lineage queries. */
    parentIdx: index('idx_portal_layouts_parent').on(t.parentLayoutId),
  }),
);

export type PortalLayoutRow = typeof portalLayouts.$inferSelect;
export type NewPortalLayoutRow = typeof portalLayouts.$inferInsert;
