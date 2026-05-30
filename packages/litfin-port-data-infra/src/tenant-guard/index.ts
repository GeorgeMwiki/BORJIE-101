/**
 * @borjie/litfin-port-data-infra/tenant-guard — multi-tenant isolation primitives.
 *
 * Public surface (LITFIN-ported, verbatim discipline):
 *
 *   Brand + validate tenant ids:
 *     - asTenantId
 *     - assertSameTenant
 *     - TenantId (type), TenantContext (type), IsolationViolation (error)
 *
 *   Async-local context:
 *     - runInTenantContext, runInTenantContextSync
 *     - getTenantContext, tryGetTenantContext
 *
 *   Next.js adapter:
 *     - withTenantContext (route-handler wrapper)
 *     - bindTenantContextOnRequest
 *
 *   Redis + storage prefixing:
 *     - tenantKey, wrapRedisWithTenantPrefix, assertTenantPrefixedKey
 *     - tenantPath, wrapStorageWithTenantPrefix, assertTenantPrefixedPath
 *
 *   Logging:
 *     - scrubLogEntry, deepScrubLogEntry, tenantScrubberRedactPaths
 *
 *   Audit chain:
 *     - assertTenantChainContinuity, assertTenantChainContinuitySync
 */

export type {
  TenantId,
  TenantContext,
  IsolationLayer,
  IsolationViolationKind,
} from "./types";
export { asTenantId, assertSameTenant, IsolationViolation } from "./types";

export {
  runInTenantContext,
  runInTenantContextSync,
  getTenantContext,
  tryGetTenantContext,
  __unstable__resetTenantStorageForTestsOnly,
} from "./context";

export type {
  RequestLike,
  ResolveContext,
  WithTenantContextOptions,
} from "./nextjs-adapter";
export {
  withTenantContext,
  bindTenantContextOnRequest,
} from "./nextjs-adapter";

export type { RedisLike } from "./redis-prefix";
export {
  tenantKey,
  assertTenantPrefixedKey,
  wrapRedisWithTenantPrefix,
} from "./redis-prefix";

export type { S3LikeClient } from "./storage-prefix";
export {
  tenantPath,
  assertTenantPrefixedPath,
  wrapStorageWithTenantPrefix,
} from "./storage-prefix";

export {
  scrubLogEntry,
  deepScrubLogEntry,
  tenantScrubberRedactPaths,
} from "./log-scrubber";

export type { ChainEntryLike, AuditChainLookup } from "./audit-chain";
export {
  assertTenantChainContinuity,
  assertTenantChainContinuitySync,
} from "./audit-chain";
