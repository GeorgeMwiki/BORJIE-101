/**
 * Universal Language Packs — Drizzle schema (UNIV-2).
 *
 * Spec: Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md
 * Migration: packages/database/drizzle/0056_universal_language_packs.sql
 *
 * Mirrors the columns of `language_pack_definitions` — the global
 * registry of every language pack Mr. Mwikila supports (live or
 * reserved). Adding a new language to Borjie = adding a row here +
 * adding a `@borjie/language-pack-{code}` package; no core code change.
 *
 * NO RLS — global reference dataset (see migration header comment).
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// language_pack_definitions — global pack registry
// ============================================================================

export const languagePackDefinitions = pgTable(
  'language_pack_definitions',
  {
    /** canonical pack id; equals bcp47 for region-locked packs */
    id: text('id').primaryKey(),

    /** IETF BCP-47 language tag per RFC 5646 */
    bcp47: text('bcp47').notNull(),

    /** ISO 639-1 two-letter code (NULL if absent) */
    iso6391: text('iso_639_1'),

    /** ISO 639-2 three-letter bibliographic code (NULL if absent) */
    iso6392: text('iso_639_2'),

    /** ISO 639-3 three-letter individual-language code */
    iso6393: text('iso_639_3').notNull(),

    /** native display name */
    nativeName: text('native_name').notNull(),

    /** English display name */
    englishName: text('english_name').notNull(),

    /** ISO 15924 script identifier */
    script: text('script').notNull(),

    /** TRUE for right-to-left scripts */
    isRtl: boolean('is_rtl').notNull().default(false),

    /** 'live' | 'reserved' */
    status: text('status').notNull(),

    /** BCP-47 region variants this pack supports */
    regionVariants: text('region_variants').array().notNull().default([]),

    /** ISO 639-3 macrolanguage id if applicable */
    macrolanguage: text('macrolanguage'),

    /** pointer to implementation package id (NULL for reserved) */
    implementationPackage: text('implementation_package'),

    /** optional pointer to a morphology package */
    morphologyPackageId: text('morphology_package_id'),

    /** primary citation URL */
    citationUrl: text('citation_url').notNull(),

    /** citation title */
    citationTitle: text('citation_title').notNull(),

    /** citation accessed-at date (ISO 8601) */
    citationAccessedAt: text('citation_accessed_at').notNull(),

    /** audit-hash for tamper detection */
    auditHash: text('audit_hash').notNull(),

    /** row insert time */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** last update time */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    bcp47UniqIdx: uniqueIndex('idx_language_pack_definitions_bcp47').on(
      t.bcp47,
    ),
    iso6391Idx: index('idx_language_pack_definitions_iso_639_1').on(t.iso6391),
    iso6393Idx: index('idx_language_pack_definitions_iso_639_3').on(t.iso6393),
    statusIdx: index('idx_language_pack_definitions_status').on(t.status),
    scriptIdx: index('idx_language_pack_definitions_script').on(t.script),
    rtlIdx: index('idx_language_pack_definitions_rtl').on(t.isRtl),
  }),
);

export type LanguagePackDefinitionRow =
  typeof languagePackDefinitions.$inferSelect;

export type LanguagePackDefinitionInsert =
  typeof languagePackDefinitions.$inferInsert;
