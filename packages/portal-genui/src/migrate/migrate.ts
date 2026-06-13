/**
 * Schema-evolution lane for persisted `PortalTab` documents.
 *
 * A spec the brain minted today is JSONB in `portal_tabs`. When the schema
 * grows a new shape tomorrow (`PORTAL_TAB_SCHEMA_VERSION` bumps to 2, 3, …)
 * every archived row written under an older version MUST either be upgraded
 * forward to the current shape or fail LOUDLY — it must never silently rot
 * (parse-throw with a cryptic Zod error) nor be silently accepted as-is.
 *
 * This module is the chokepoint the persistence READ path calls before
 * `PortalTabSchema.parse`:
 *
 *   const { tab } = migratePortalTabRaw(rawJsonbValue);
 *
 * Mechanics — an ORDERED registry of up-migrations, each a pure `vN -> vN+1`
 * transform. `migratePortalTabRaw` reads `raw.version`, then walks the chain
 * applying every step from that version up to `PORTAL_TAB_SCHEMA_VERSION`,
 * then validates the result with `PortalTabSchema`. For v1 the chain is empty
 * (v1 IS the current target), but the FRAMEWORK + registry + a documented
 * no-op v1 entry already exist, so shipping a v2 migration later is exactly
 * ONE array entry — no caller, no read-path, no test scaffold churn.
 *
 * Fail-loud contract — a `PortalTabMigrationError` (typed `code`) is thrown
 * when the raw version is absent / not an integer, is NEWER than the current
 * known version (a row written by a future deploy a rollback can't read), or
 * has no registered step to advance it (an unmigratable gap in the chain).
 *
 * Pure + immutable: every step returns a NEW object; the input `raw` is never
 * mutated. No `process.env`, no I/O — the read path owns the DB.
 *
 * @module @borjie/portal-genui/migrate/migrate
 */

import {
  PORTAL_TAB_SCHEMA_VERSION,
  PortalTabSchema,
  type PortalTab,
} from '../types.js';

// ---------------------------------------------------------------------------
// 1. Error — typed, fail-loud.
// ---------------------------------------------------------------------------

/** Discriminates WHY a raw spec could not be migrated to the current shape. */
export type MigrationFailureCode =
  /** `raw` is not an object, or `raw.version` is missing / not a positive int. */
  | 'INVALID_VERSION'
  /** `raw.version` is greater than `PORTAL_TAB_SCHEMA_VERSION` (future row). */
  | 'VERSION_TOO_NEW'
  /** No registered step advances some intermediate version toward the target. */
  | 'UNMIGRATABLE'
  /** The migrated shape failed `PortalTabSchema` validation. */
  | 'POST_MIGRATION_INVALID';

/**
 * Thrown by the migration lane when a persisted spec cannot be brought to the
 * current schema version. Carries a machine-readable `code` plus the observed
 * + target versions so the read path can log/alert precisely (and a CI canary
 * can assert archived specs still migrate under HEAD).
 */
export class PortalTabMigrationError extends Error {
  public readonly code: MigrationFailureCode;
  public readonly fromVersion: number | undefined;
  public readonly toVersion: number;

  public constructor(
    code: MigrationFailureCode,
    message: string,
    detail: {
      readonly fromVersion?: number | undefined;
      readonly toVersion: number;
      readonly cause?: unknown;
    },
  ) {
    super(message, detail.cause !== undefined ? { cause: detail.cause } : undefined);
    this.name = 'PortalTabMigrationError';
    this.code = code;
    this.fromVersion = detail.fromVersion;
    this.toVersion = detail.toVersion;
  }
}

// ---------------------------------------------------------------------------
// 2. Migration step + registry framework.
// ---------------------------------------------------------------------------

/**
 * One up-migration `from -> to` (always `to === from + 1`). `up` is a pure
 * transform from the raw shape at version `from` to the raw shape at version
 * `to`; it MUST return a NEW object and MUST set `version` to `to`. The
 * `describe` label appears in the `applied` trace and in error messages.
 */
export interface PortalTabMigrationStep {
  readonly from: number;
  readonly to: number;
  readonly describe: string;
  readonly up: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * The canonical, ordered registry. Adding a real migration later is ONE entry:
 *
 *   {
 *     from: 1,
 *     to: 2,
 *     describe: 'v1->v2: split `address` into `address`+`geo`',
 *     up: (raw) => ({ ...raw, version: 2, geo: deriveGeo(raw.address) }),
 *   }
 *
 * Today the current version is 1, so the chain TO the target is empty. The
 * registry is intentionally non-empty regardless: a documented no-op v0->v1
 * entry proves the framework wires end-to-end and keeps the "one array entry"
 * promise honest. v0 is a synthetic pre-release shape no production row uses;
 * it exists only so the lane has a live, tested step. `Object.freeze` keeps
 * the registry immutable.
 */
export const PORTAL_TAB_MIGRATIONS: ReadonlyArray<PortalTabMigrationStep> =
  Object.freeze([
    Object.freeze({
      from: 0,
      to: 1,
      describe: 'v0->v1: stamp the initial schema version on a pre-release row',
      up: (raw: Record<string, unknown>): Record<string, unknown> => ({
        ...raw,
        version: 1,
      }),
    }) as PortalTabMigrationStep,
  ]);

// ---------------------------------------------------------------------------
// 3. Helpers — pure version reading + step lookup.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read `raw.version`, asserting it is a positive integer. Throws
 * `INVALID_VERSION` for a non-object or a missing / non-integer version so a
 * corrupt or hand-edited JSONB blob fails loudly instead of defaulting.
 */
function readRawVersion(raw: unknown, toVersion: number): number {
  if (!isPlainObject(raw)) {
    throw new PortalTabMigrationError(
      'INVALID_VERSION',
      'portal-genui migrate: raw spec is not an object',
      { toVersion },
    );
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new PortalTabMigrationError(
      'INVALID_VERSION',
      `portal-genui migrate: raw.version must be a non-negative integer (got ${JSON.stringify(version)})`,
      { toVersion },
    );
  }
  return version;
}

/** Find the registered `from -> from+1` step, or `undefined` when absent. */
function stepFrom(
  registry: ReadonlyArray<PortalTabMigrationStep>,
  from: number,
): PortalTabMigrationStep | undefined {
  return registry.find((step) => step.from === from);
}

// ---------------------------------------------------------------------------
// 4. The migrator.
// ---------------------------------------------------------------------------

export interface MigratePortalTabResult {
  /** The fully-migrated, schema-validated tab. */
  readonly tab: PortalTab;
  /** The version read off the raw input. */
  readonly fromVersion: number;
  /** The current target version (`PORTAL_TAB_SCHEMA_VERSION`). */
  readonly toVersion: number;
  /** Ordered `describe` labels of the steps applied (empty when already current). */
  readonly applied: ReadonlyArray<string>;
}

export interface MigratePortalTabOptions {
  /**
   * Override the migration registry. Defaults to {@link PORTAL_TAB_MIGRATIONS}.
   * Tests inject a synthetic legacy chain here; production passes nothing.
   */
  readonly registry?: ReadonlyArray<PortalTabMigrationStep>;
  /**
   * Override the target version. Defaults to {@link PORTAL_TAB_SCHEMA_VERSION}.
   * Tests use this to simulate "current = v2" without bumping the real const.
   */
  readonly targetVersion?: number;
}

/**
 * Bring a persisted raw spec up to the current schema version and validate it.
 *
 * Reads `raw.version`, then applies every registered up-migration from that
 * version to the target, in order, re-reading the version after each step to
 * detect a malformed transform. Validates the final shape with
 * `PortalTabSchema`. Throws `PortalTabMigrationError` on any fail-loud
 * condition (see {@link MigrationFailureCode}); never returns a partially
 * migrated or unvalidated tab.
 *
 * Pure / immutable — `raw` is treated as read-only; each step yields a new
 * object.
 */
export function migratePortalTabRaw(
  raw: unknown,
  options: MigratePortalTabOptions = {},
): MigratePortalTabResult {
  const toVersion = options.targetVersion ?? PORTAL_TAB_SCHEMA_VERSION;
  const registry = options.registry ?? PORTAL_TAB_MIGRATIONS;

  const fromVersion = readRawVersion(raw, toVersion);

  if (fromVersion > toVersion) {
    throw new PortalTabMigrationError(
      'VERSION_TOO_NEW',
      `portal-genui migrate: raw.version ${fromVersion} is newer than the known schema version ${toVersion} — this row was written by a future deploy and cannot be read here`,
      { fromVersion, toVersion },
    );
  }

  const applied: string[] = [];
  // Walk the chain. `current` is rebound to a fresh object each step; never
  // mutated. `version` advances by exactly one per registered step.
  let current: Record<string, unknown> = raw as Record<string, unknown>;
  let version = fromVersion;

  while (version < toVersion) {
    const step = stepFrom(registry, version);
    if (!step) {
      throw new PortalTabMigrationError(
        'UNMIGRATABLE',
        `portal-genui migrate: no registered up-migration from version ${version} (need to reach ${toVersion})`,
        { fromVersion, toVersion },
      );
    }
    const next = step.up(current);
    const nextVersion = readRawVersion(next, toVersion);
    if (nextVersion !== step.to) {
      throw new PortalTabMigrationError(
        'UNMIGRATABLE',
        `portal-genui migrate: step '${step.describe}' left version ${nextVersion}, expected ${step.to}`,
        { fromVersion, toVersion },
      );
    }
    current = next;
    version = nextVersion;
    applied.push(step.describe);
  }

  const parsed = PortalTabSchema.safeParse(current);
  if (!parsed.success) {
    throw new PortalTabMigrationError(
      'POST_MIGRATION_INVALID',
      `portal-genui migrate: spec failed validation after migrating ${fromVersion} -> ${toVersion}: ${parsed.error.message}`,
      { fromVersion, toVersion, cause: parsed.error },
    );
  }

  return {
    tab: parsed.data,
    fromVersion,
    toVersion,
    applied: Object.freeze(applied),
  };
}

// ---------------------------------------------------------------------------
// 5. Non-throwing pre-flight check.
// ---------------------------------------------------------------------------

export interface MigratableVerdict {
  /** True when {@link migratePortalTabRaw} would succeed for this raw input. */
  readonly ok: boolean;
  /** The version read off the raw input, when readable. */
  readonly fromVersion?: number;
  /** The current target version. */
  readonly toVersion: number;
  /** Failure code when `ok` is false. */
  readonly code?: MigrationFailureCode;
  /** Human-readable reason when `ok` is false. */
  readonly reason?: string;
}

/**
 * Non-throwing pre-flight — answers "would this raw spec migrate cleanly under
 * HEAD?" without throwing. Powers the CI canary that renders every archived
 * spec under the current build and a list/get path that wants to report a
 * skip rather than crash the whole batch.
 */
export function verifyMigratable(
  raw: unknown,
  options: MigratePortalTabOptions = {},
): MigratableVerdict {
  const toVersion = options.targetVersion ?? PORTAL_TAB_SCHEMA_VERSION;
  try {
    const result = migratePortalTabRaw(raw, options);
    return { ok: true, fromVersion: result.fromVersion, toVersion };
  } catch (error) {
    if (error instanceof PortalTabMigrationError) {
      return {
        ok: false,
        toVersion,
        code: error.code,
        reason: error.message,
        ...(error.fromVersion !== undefined
          ? { fromVersion: error.fromVersion }
          : {}),
      };
    }
    return {
      ok: false,
      toVersion,
      code: 'POST_MIGRATION_INVALID',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
