/**
 * Marketplace — listings + ratings.
 *
 * Per DATA_MODEL.md §3.7. Tanzania-first marketplace for the mining
 * supply chain: workers, equipment, QC tools, labs, experts and buyers.
 * Listings carry a PostGIS POINT (GeoJSON at ORM boundary); ratings are
 * polymorphic over any subject_kind.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

export const marketplaceListings = pgTable(
  'marketplace_listings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** worker|equipment|qc_tool|lab|expert|buyer. */
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    priceTzs: numeric('price_tzs', { precision: 18, scale: 2 }),
    priceUnit: text('price_unit'),
    /** PostGIS POINT. GeoJSON string at ORM boundary. */
    location: text('location'),
    contactUserId: text('contact_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** private|tanzania|regional|global. */
    visibility: text('visibility').notNull().default('tanzania'),
    /** active|paused|expired|sold|removed. */
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    photos: text('photos').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('marketplace_listings_tenant_idx').on(t.tenantId),
    categoryIdx: index('marketplace_listings_category_idx').on(t.category),
    visibilityIdx: index('marketplace_listings_visibility_idx').on(t.visibility),
    statusIdx: index('marketplace_listings_status_idx').on(t.status),
  }),
);

// ============================================================================
// ratings — polymorphic reputation entries
// ============================================================================

export const ratings = pgTable(
  'ratings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    subjectId: text('subject_id').notNull(),
    /** user|company|asset|buyer|listing|lab|expert. */
    subjectKind: text('subject_kind').notNull(),
    raterUserId: text('rater_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 1-5. */
    score: smallint('score').notNull(),
    comment: text('comment'),
    attributes: jsonb('attributes').notNull().default({}),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('ratings_subject_idx').on(t.subjectKind, t.subjectId),
    tenantIdx: index('ratings_tenant_idx').on(t.tenantId),
    scoreIdx: index('ratings_score_idx').on(t.subjectKind, t.score),
  }),
);

export type MarketplaceListing = typeof marketplaceListings.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
