/**
 * `@borjie/language-packs` — public surface (UNIV-2).
 *
 * The canonical registry of every language pack Mr. Mwikila supports.
 * Adding a language = adding a pack-definition row + a
 * `@borjie/language-pack-{code}` implementation package; no core code
 * change. The persona, reasoning core, calibration, audit chain and
 * security posture are all language-agnostic. This package is the
 * thin pluggable layer above the core.
 *
 * Spec: Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md
 * Migration: packages/database/drizzle/0056_universal_language_packs.sql
 */

export {
  type Citation,
  type LanguagePackDefinition,
  type LanguagePackDefinitionsRepository,
  type LanguagePackErrorCode,
  type PackStatus,
  LanguagePackError,
  PACK_STATUSES,
  citationSchema,
  languagePackDefinitionSchema,
  packStatusSchema,
} from './types.js';

export {
  type CreateLoggerDeps,
  type LogEmitter,
  type LogLevel,
  type Logger,
  type ServiceIdentity,
  type TelemetryConfig,
  createLogger,
} from './logger.js';

export { SEED_PACK_DEFINITIONS } from './seed/seed-pack-definitions.js';

export {
  type CreateInMemoryRegistryDeps,
  type InMemoryLanguagePackRegistry,
  createInMemoryLanguagePackRegistry,
} from './registry/in-memory-registry.js';
