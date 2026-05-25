/**
 * Field-level encryption-at-rest — Phase D D1 barrel.
 *
 * Closes the audit-surfaced gap: `data-classification.ts` DECLARES
 * `encryptAtRest: true` on ~30 PII columns but no app-layer
 * middleware actually encrypts/decrypts them. This module is the
 * middleware.
 *
 * Composition entry point: `selectEncryptionPort(env)` — picks the
 * KMS adapter when `AWS_KMS_KEY_ID` is set (with `AWS_REGION`), the
 * libsodium adapter otherwise. Both adapters require
 * `ENCRYPTION_MASTER_KEY`; absent that they throw
 * `EncryptionKeyUnavailableError` at construction time so misconfigured
 * services fail loudly at boot rather than silently dropping PII in
 * plaintext.
 *
 * See `Docs/SECURITY/ENCRYPTION_AT_REST.md` for the operator runbook
 * (env vars, KMS configuration, rotation procedure).
 */

export {
  ENCRYPTED_BLOB_PREFIX,
  EncryptionAuthenticationError,
  EncryptionKeyUnavailableError,
  deserializeBlob,
  serializeBlob,
  type DecryptArgs,
  type EncryptArgs,
  type EncryptedBlob,
  type EncryptionAlgorithm,
  type EncryptionPort,
  type RotateArgs,
} from './encryption-port.js';

export {
  DEK_LENGTH_BYTES,
  deriveDek,
  loadMasterKeySnapshot,
  type EncryptionEnv,
  type MasterKeySnapshot,
} from './tenant-key-derivation.js';

export {
  createLibsodiumAdapter,
  type LibsodiumAdapterDeps,
} from './libsodium-adapter.js';

export {
  createKmsAdapter,
  type KmsAdapterConfig,
  type KmsClientLike,
  type KmsLogger,
} from './kms-adapter.js';

export {
  getTenantRegion,
  type GetTenantRegionDb,
} from './get-tenant-region.js';

export {
  __resetTableCacheForTests,
  decryptRow,
  decryptRows,
  encryptRow,
  toSnakeCase,
  type DecryptRowArgs,
  type EncryptRowArgs,
  type FieldEncryptionAuditSink,
} from './drizzle-encryption-middleware.js';

// ─────────────────────────────────────────────────────────────────────
// selectEncryptionPort — composition entry point
// ─────────────────────────────────────────────────────────────────────

import {
  createKmsAdapter,
  type KmsLogger,
} from './kms-adapter.js';
import { createLibsodiumAdapter } from './libsodium-adapter.js';
import type { EncryptionPort } from './encryption-port.js';
import {
  loadMasterKeySnapshot,
  type EncryptionEnv,
} from './tenant-key-derivation.js';

export interface SelectEncryptionPortEnv extends EncryptionEnv {
  readonly AWS_KMS_KEY_ID?: string;
  readonly AWS_REGION?: string;
  /**
   * Optional per-region key ARNs / aliases. When a `tenantRegion` is
   * supplied to `selectEncryptionPort`, we look up
   * `env[`KMS_KEY_${region}`]` (uppercased, hyphens preserved) and
   * fall back to `AWS_KMS_KEY_ID` if no region-specific key is set.
   *
   * Example env keys: `KMS_KEY_EU_WEST_1`, `KMS_KEY_AF_SOUTH_1`,
   * `KMS_KEY_US_EAST_1`. Hyphens in AWS region names are mapped to
   * underscores so they're valid shell identifiers.
   */
  readonly [perRegionKey: `KMS_KEY_${string}`]: string | undefined;
}

export interface SelectEncryptionPortOptions {
  readonly logger?: KmsLogger;
  /**
   * Optional per-tenant region (from `tenants.region`). When provided
   * AND it differs from `env.AWS_REGION`, the adapter selects a
   * region-specific KMS key (via `env[`KMS_KEY_${REGION}`]`) and a
   * region-specific KMS client, so PII written for a tenant in one
   * AWS region never leaks into a different region's KMS account.
   *
   * Falls back to `env.AWS_KMS_KEY_ID` + `env.AWS_REGION` when no
   * region-specific key is configured.
   */
  readonly tenantRegion?: string;
}

/**
 * Pick the encryption adapter based on the supplied environment.
 *
 *   - When `AWS_KMS_KEY_ID` AND `AWS_REGION` are set → KMS adapter
 *     (envelope encryption; CMK rotation handled by AWS).
 *   - Otherwise → libsodium adapter (XChaCha20-Poly1305 when the
 *     dependency is installed, AES-256-GCM Node built-in fallback
 *     otherwise).
 *
 * When `tenantRegion` is supplied and differs from `env.AWS_REGION`,
 * the adapter consults a region-specific KMS key from
 * `env[`KMS_KEY_${region}`]` (underscores in place of hyphens, e.g.
 * `KMS_KEY_AF_SOUTH_1`) so PII for that tenant is encrypted under a
 * regional CMK. If no region-specific key is set, we fall back to
 * `AWS_KMS_KEY_ID` and log a one-shot warn.
 *
 * `ENCRYPTION_MASTER_KEY` is required in both branches — the KMS
 * adapter also needs it for the fallback path when `@aws-sdk/client-
 * kms` cannot be loaded at runtime.
 */
export async function selectEncryptionPort(
  env: SelectEncryptionPortEnv,
  options: SelectEncryptionPortOptions = {},
): Promise<EncryptionPort> {
  const snapshot = loadMasterKeySnapshot(env);
  const wantsKms = !!env.AWS_KMS_KEY_ID && !!env.AWS_REGION;
  if (wantsKms) {
    const { region, kmsKeyId } = resolveRegionAndKey(env, options);
    return createKmsAdapter({
      kmsKeyId,
      region,
      fallbackSnapshot: snapshot,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  }
  return createLibsodiumAdapter({ snapshot });
}

/**
 * Pure helper — given the env and an optional `tenantRegion`, returns
 * the region + KMS key the adapter should use. When `tenantRegion`
 * matches `env.AWS_REGION` (or is absent), returns the default pair.
 * When it differs, looks up `env[`KMS_KEY_${REGION_UPPER}`]` (with
 * hyphens replaced by underscores); if absent, falls back to the
 * default key and logs a warn.
 *
 * Exported for tests so the dispatch logic can be exercised without a
 * live KMS client.
 */
export function resolveRegionAndKey(
  env: SelectEncryptionPortEnv,
  options: SelectEncryptionPortOptions,
): { readonly region: string; readonly kmsKeyId: string } {
  const defaultRegion = env.AWS_REGION as string;
  const defaultKey = env.AWS_KMS_KEY_ID as string;
  const tenantRegion = options.tenantRegion?.trim();
  if (!tenantRegion || tenantRegion === defaultRegion) {
    return { region: defaultRegion, kmsKeyId: defaultKey };
  }
  const envKey = `KMS_KEY_${tenantRegion.toUpperCase().replace(/-/g, '_')}` as const;
  const perRegionKey = (env as Record<string, string | undefined>)[envKey];
  if (perRegionKey && perRegionKey.length > 0) {
    return { region: tenantRegion, kmsKeyId: perRegionKey };
  }
  options.logger?.warn(
    'selectEncryptionPort: no region-specific KMS key configured; falling back to AWS_KMS_KEY_ID',
    { tenantRegion, defaultRegion, expectedEnvVar: envKey },
  );
  return { region: tenantRegion, kmsKeyId: defaultKey };
}

// ─────────────────────────────────────────────────────────────────────
// selectEncryptionPortForTenant — request-scoped composition (W1.5)
//
// `selectEncryptionPort` (above) is the boot-time entry point: it picks
// a single KMS key for `env.AWS_REGION`. That singleton is fine for
// single-region deployments but does NOT honour per-tenant data
// residency — every encrypt() call lands in the same region regardless
// of `tenants.region`.
//
// This helper wires `getTenantRegion(db, tenantId)` -> `tenantRegion`
// -> `selectEncryptionPort`. Callers use it per-request when they need
// region-routed KMS calls (TZ PDPA + KE DPA + ZA POPIA + NG NDPR data-
// residency). Returning a fresh adapter per call costs an SDK
// construction; production wiring should cache per (region, kmsKeyId)
// pair if hot-path latency matters.
//
// Returns the same adapter shape as `selectEncryptionPort` so consumers
// don't need to branch.
// ─────────────────────────────────────────────────────────────────────

/**
 * Hook so the encryption module doesn't structurally depend on the
 * platform tenants service. Composition root passes a closure that
 * calls `getTenantRegion(db, tenantId)` from this same package.
 */
export type TenantRegionResolver = (
  tenantId: string,
) => Promise<string | null>;

export interface SelectEncryptionPortForTenantOptions extends SelectEncryptionPortOptions {
  /**
   * Closure that resolves `tenants.region` for `tenantId`. When
   * supplied AND it returns a non-null region, the adapter routes its
   * KMS calls to that region (per the `resolveRegionAndKey` rules).
   * When the resolver returns null, falls back to `env.AWS_REGION`.
   */
  readonly regionResolver: TenantRegionResolver;
  /**
   * Tenant id being processed. The resolver is only called when this
   * is a non-empty string; platform-scoped calls (tenantId === null)
   * use `env.AWS_REGION` directly.
   */
  readonly tenantId: string | null;
}

/**
 * Request-scoped composition of an EncryptionPort. Reads the tenant's
 * data-residency region via `regionResolver` and threads it through
 * `selectEncryptionPort` so the KMS adapter binds to the tenant's home
 * region.
 *
 * Usage at composition root:
 *
 *   const port = await selectEncryptionPortForTenant(process.env, {
 *     tenantId: auth.tenantId,
 *     regionResolver: (tenantId) => getTenantRegion(db, tenantId),
 *     logger,
 *   });
 *
 * Resolution order (matches `kms-adapter.ts` JSDoc contract):
 *   1. `regionResolver(tenantId)` from `tenants.region` (when non-null)
 *   2. `env.AWS_REGION` fallback
 *   3. KMS-adapter boot fails loud when neither resolves
 */
export async function selectEncryptionPortForTenant(
  env: SelectEncryptionPortEnv,
  options: SelectEncryptionPortForTenantOptions,
): Promise<EncryptionPort> {
  const { tenantId, regionResolver, ...rest } = options;
  let tenantRegion: string | undefined;
  if (tenantId && tenantId.length > 0) {
    try {
      const resolved = await regionResolver(tenantId);
      if (resolved && resolved.length > 0) {
        tenantRegion = resolved;
      }
    } catch (error) {
      rest.logger?.warn?.(
        'selectEncryptionPortForTenant: regionResolver threw; falling back to env.AWS_REGION',
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  return selectEncryptionPort(env, {
    ...rest,
    ...(tenantRegion ? { tenantRegion } : {}),
  });
}
