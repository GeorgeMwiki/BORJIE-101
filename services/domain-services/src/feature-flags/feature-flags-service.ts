/**
 * Feature Flags Service — Wave 9 enterprise polish.
 *
 * Per-tenant gating for platform capabilities. Operators toggle features on
 * or off for specific orgs without code deploys.
 *
 * Resolution order (isEnabled):
 *   1. If a tenant-scoped override exists for (tenantId, flagKey), use its
 *      `enabled` value.
 *   2. Else fall back to the platform default (`feature_flags.default_enabled`).
 *   3. If the flag is unknown, return FALSE (closed by default — safer than
 *      silently enabling untracked features).
 *
 * Pure / immutable: every output is a new object, no input is mutated.
 *
 * Tenant isolation is enforced at the repository boundary: every query
 * passes the caller's tenantId, and cross-tenant writes are impossible
 * because overrides are keyed by (tenantId, flagKey) UNIQUE.
 */
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import {
  featureFlags,
  tenantFeatureFlagOverrides,
} from '@borjie/database';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FeatureFlag {
  readonly id: string;
  readonly flagKey: string;
  readonly description: string | null;
  readonly defaultEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantFeatureFlagOverride {
  readonly id: string;
  readonly tenantId: string;
  readonly flagKey: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolvedFeatureFlag {
  readonly flagKey: string;
  readonly description: string | null;
  readonly defaultEnabled: boolean;
  readonly enabled: boolean;
  readonly isOverridden: boolean;
  readonly overrideValue: boolean | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FeatureFlagError extends Error {
  constructor(
    message: string,
    public readonly code: 'VALIDATION' | 'UNKNOWN_FLAG' | 'TENANT_MISMATCH',
  ) {
    super(message);
    this.name = 'FeatureFlagError';
  }
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface FeatureFlagsRepository {
  listFlags(): Promise<readonly FeatureFlag[]>;
  findFlagByKey(flagKey: string): Promise<FeatureFlag | null>;
  listOverridesForTenant(
    tenantId: string,
  ): Promise<readonly TenantFeatureFlagOverride[]>;
  findOverride(
    tenantId: string,
    flagKey: string,
  ): Promise<TenantFeatureFlagOverride | null>;
  upsertOverride(
    override: TenantFeatureFlagOverride,
  ): Promise<TenantFeatureFlagOverride>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FeatureFlagsServiceDeps {
  readonly repo: FeatureFlagsRepository;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface FeatureFlagsService {
  isEnabled(tenantId: string, flagKey: string): Promise<boolean>;
  list(tenantId: string): Promise<readonly ResolvedFeatureFlag[]>;
  setOverride(
    tenantId: string,
    flagKey: string,
    enabled: boolean,
  ): Promise<TenantFeatureFlagOverride>;
}

function validateTenantId(tenantId: string): void {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new FeatureFlagError('tenantId is required', 'VALIDATION');
  }
}

function validateFlagKey(flagKey: string): void {
  if (!flagKey || typeof flagKey !== 'string' || flagKey.trim() === '') {
    throw new FeatureFlagError('flagKey is required', 'VALIDATION');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(flagKey)) {
    throw new FeatureFlagError(
      `invalid flagKey "${flagKey}": must be snake_case (a-z, 0-9, _)`,
      'VALIDATION',
    );
  }
}

export function createFeatureFlagsService(
  deps: FeatureFlagsServiceDeps,
): FeatureFlagsService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomUUID());

  return {
    async isEnabled(tenantId, flagKey) {
      validateTenantId(tenantId);
      validateFlagKey(flagKey);

      const flag = await deps.repo.findFlagByKey(flagKey);
      if (!flag) {
        // Unknown flag — closed by default. Callers that want to treat
        // unknown flags as ON must wrap this service.
        return false;
      }
      const override = await deps.repo.findOverride(tenantId, flagKey);
      if (override) return override.enabled;
      return flag.defaultEnabled;
    },

    async list(tenantId) {
      validateTenantId(tenantId);
      const [flags, overrides] = await Promise.all([
        deps.repo.listFlags(),
        deps.repo.listOverridesForTenant(tenantId),
      ]);
      const overrideByKey = new Map<string, TenantFeatureFlagOverride>();
      for (const o of overrides) {
        // Defensive: even though the repo filters by tenantId, double-check.
        if (o.tenantId === tenantId) overrideByKey.set(o.flagKey, o);
      }
      return flags.map((flag) => {
        const ov = overrideByKey.get(flag.flagKey) ?? null;
        return {
          flagKey: flag.flagKey,
          description: flag.description,
          defaultEnabled: flag.defaultEnabled,
          enabled: ov ? ov.enabled : flag.defaultEnabled,
          isOverridden: ov !== null,
          overrideValue: ov ? ov.enabled : null,
        };
      });
    },

    async setOverride(tenantId, flagKey, enabled) {
      validateTenantId(tenantId);
      validateFlagKey(flagKey);
      if (typeof enabled !== 'boolean') {
        throw new FeatureFlagError(
          'enabled must be boolean',
          'VALIDATION',
        );
      }

      const flag = await deps.repo.findFlagByKey(flagKey);
      if (!flag) {
        throw new FeatureFlagError(
          `unknown flag "${flagKey}"`,
          'UNKNOWN_FLAG',
        );
      }

      const existing = await deps.repo.findOverride(tenantId, flagKey);
      const nowIso = now().toISOString();
      const row: TenantFeatureFlagOverride = {
        id: existing?.id ?? genId(),
        tenantId,
        flagKey,
        enabled,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      return deps.repo.upsertOverride(row);
    },
  };
}

// ---------------------------------------------------------------------------
// Drizzle-backed repository
// ---------------------------------------------------------------------------

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  [k: string]: any;
}

export class DrizzleFeatureFlagsRepository implements FeatureFlagsRepository {
  constructor(private readonly db: DrizzleLike) {}

  async listFlags(): Promise<readonly FeatureFlag[]> {
    const rows = await this.db.select().from(featureFlags);
    return (rows as Record<string, unknown>[]).map(rowToFlag);
  }

  async findFlagByKey(flagKey: string): Promise<FeatureFlag | null> {
    const rows = await this.db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.flagKey, flagKey))
      .limit(1);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToFlag(row) : null;
  }

  async listOverridesForTenant(
    tenantId: string,
  ): Promise<readonly TenantFeatureFlagOverride[]> {
    const rows = await this.db
      .select()
      .from(tenantFeatureFlagOverrides)
      .where(eq(tenantFeatureFlagOverrides.tenantId, tenantId));
    return (rows as Record<string, unknown>[]).map(rowToOverride);
  }

  async findOverride(
    tenantId: string,
    flagKey: string,
  ): Promise<TenantFeatureFlagOverride | null> {
    const rows = await this.db
      .select()
      .from(tenantFeatureFlagOverrides)
      .where(
        and(
          eq(tenantFeatureFlagOverrides.tenantId, tenantId),
          eq(tenantFeatureFlagOverrides.flagKey, flagKey),
        ),
      )
      .limit(1);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToOverride(row) : null;
  }

  async upsertOverride(
    override: TenantFeatureFlagOverride,
  ): Promise<TenantFeatureFlagOverride> {
    // Use ON CONFLICT on (tenant_id, flag_key) — drizzle's onConflictDoUpdate.
    await this.db
      .insert(tenantFeatureFlagOverrides)
      .values(overrideToRow(override))
      .onConflictDoUpdate({
        target: [
          tenantFeatureFlagOverrides.tenantId,
          tenantFeatureFlagOverrides.flagKey,
        ],
        set: {
          enabled: override.enabled,
          updatedAt: new Date(override.updatedAt),
        },
      });
    return override;
  }
}

// ---------------------------------------------------------------------------
// Row <-> Entity mapping
// ---------------------------------------------------------------------------

function rowToFlag(row: Record<string, unknown>): FeatureFlag {
  return {
    id: row.id as string,
    flagKey: row.flagKey as string,
    description: (row.description as string | null) ?? null,
    defaultEnabled: Boolean(row.defaultEnabled),
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
  };
}

function rowToOverride(
  row: Record<string, unknown>,
): TenantFeatureFlagOverride {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    flagKey: row.flagKey as string,
    enabled: Boolean(row.enabled),
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
  };
}

function overrideToRow(
  o: TenantFeatureFlagOverride,
): Record<string, unknown> {
  return {
    id: o.id,
    tenantId: o.tenantId,
    flagKey: o.flagKey,
    enabled: o.enabled,
    createdAt: new Date(o.createdAt),
    updatedAt: new Date(o.updatedAt),
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

// Suppress "unused import" for drizzle helpers that the live query path
// narrows out of the emitted SQL.
void and;
