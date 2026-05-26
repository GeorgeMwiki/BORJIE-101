/**
 * `@borjie/language-packs` — public type surface (UNIV-2).
 *
 * Companion to Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md.
 *
 * Defines the canonical pack-definition shape every language pack
 * registers under, plus the registry-port type a consumer interacts
 * with. The pack-definition is identical to the database row shape
 * (mirror of `language_pack_definitions` in migration 0056) so
 * consumers can round-trip between in-memory and database without
 * field re-mapping.
 *
 * All types are `readonly`. All constructed values are frozen
 * (~/.claude/rules/coding-style.md immutability rule).
 *
 * Standards cited:
 *   - RFC 5646 "Tags for Identifying Languages"
 *     https://tools.ietf.org/html/rfc5646  (accessed 2026-05-26)
 *   - ISO 639-3 SIL home
 *     https://iso639-3.sil.org/code_tables/639/data (accessed 2026-05-26)
 *   - ISO 15924 script codes
 *     https://www.unicode.org/iso15924/iso15924-codes.html (accessed 2026-05-26)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pack status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a pack.
 *   - 'live'     : implementation package shipped + the pack-definition
 *                  row carries a non-null `implementationPackage`.
 *   - 'reserved' : pack-definition row only — no implementation module
 *                  yet. Callers requesting a reserved pack should fall
 *                  back to the closest live pack (typically `en`).
 */
export const PACK_STATUSES = ['live', 'reserved'] as const;

export type PackStatus = (typeof PACK_STATUSES)[number];

// ---------------------------------------------------------------------------
// Citation
// ---------------------------------------------------------------------------

/**
 * URL + title + ISO date triple. Every external reference cited in a
 * pack must carry one of these.
 */
export interface Citation {
  readonly url: string;
  readonly title: string;
  readonly accessedAt: string;
}

// ---------------------------------------------------------------------------
// Pack definition
// ---------------------------------------------------------------------------

/**
 * The canonical shape every pack registers under. Mirrors the
 * `language_pack_definitions` row 1:1 (migration 0056) so an in-memory
 * registry and a database-backed registry are interchangeable.
 *
 * Live packs MUST set `implementationPackage` to the NPM module id
 * (e.g. `@borjie/language-pack-en`). Reserved packs MUST leave it
 * null. The CHECK constraint in the migration enforces this; the
 * registry validates it on insert.
 */
export interface LanguagePackDefinition {
  readonly id: string;
  readonly bcp47: string;
  readonly iso6391: string | null;
  readonly iso6392: string | null;
  readonly iso6393: string;
  readonly nativeName: string;
  readonly englishName: string;
  /** ISO 15924 four-letter script identifier */
  readonly script: string;
  readonly isRtl: boolean;
  readonly status: PackStatus;
  readonly regionVariants: ReadonlyArray<string>;
  readonly macrolanguage: string | null;
  readonly implementationPackage: string | null;
  readonly morphologyPackageId: string | null;
  readonly citation: Citation;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface LanguagePackDefinitionsRepository {
  readonly listAll: () => Promise<ReadonlyArray<LanguagePackDefinition>>;
  readonly findById: (id: string) => Promise<LanguagePackDefinition | null>;
  readonly findByBcp47: (
    tag: string,
  ) => Promise<LanguagePackDefinition | null>;
  readonly findByIso6391: (
    code: string,
  ) => Promise<LanguagePackDefinition | null>;
  readonly listByStatus: (
    status: PackStatus,
  ) => Promise<ReadonlyArray<LanguagePackDefinition>>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type LanguagePackErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'STATUS_VIOLATION'
  | 'DUPLICATE_ID';

export class LanguagePackError extends Error {
  public readonly code: LanguagePackErrorCode;
  constructor(message: string, code: LanguagePackErrorCode) {
    super(message);
    this.name = 'LanguagePackError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const packStatusSchema = z.enum(PACK_STATUSES);

export const citationSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  accessedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const languagePackDefinitionSchema = z
  .object({
    id: z.string().min(2),
    bcp47: z.string().min(2).max(35),
    iso6391: z.string().length(2).nullable(),
    iso6392: z.string().length(3).nullable(),
    iso6393: z.string().length(3),
    nativeName: z.string().min(1),
    englishName: z.string().min(1),
    script: z.string().length(4),
    isRtl: z.boolean(),
    status: packStatusSchema,
    regionVariants: z.array(z.string().min(2)).readonly(),
    macrolanguage: z.string().length(3).nullable(),
    implementationPackage: z.string().min(1).nullable(),
    morphologyPackageId: z.string().min(1).nullable(),
    citation: citationSchema,
  })
  .refine(
    (d) =>
      (d.status === 'live' && d.implementationPackage !== null) ||
      (d.status === 'reserved' && d.implementationPackage === null),
    {
      message:
        'live packs require implementationPackage; reserved packs forbid it',
      path: ['implementationPackage'],
    },
  );
