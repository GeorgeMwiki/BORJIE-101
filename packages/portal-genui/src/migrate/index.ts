/**
 * Public surface for the schema-evolution lane.
 *
 * The persistence READ path (`get` / `list`) calls `migratePortalTabRaw` on the
 * raw JSONB value BEFORE `PortalTabSchema.parse`, so an archived spec written
 * under an older `version` is upgraded forward — or fails LOUDLY with a typed
 * `PortalTabMigrationError` — and never silently rots.
 */

export {
  migratePortalTabRaw,
  verifyMigratable,
  PortalTabMigrationError,
  PORTAL_TAB_MIGRATIONS,
  type PortalTabMigrationStep,
  type MigratePortalTabResult,
  type MigratePortalTabOptions,
  type MigratableVerdict,
  type MigrationFailureCode,
} from './migrate.js';
