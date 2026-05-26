/**
 * `@borjie/tenant-isolation-guard` — public barrel.
 *
 * Defense-in-depth against cross-tenant data and action leaks.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

// ============================================================================
// Types + violation primitives
// ============================================================================
export {
  asTenantId,
  IsolationViolation,
  DEFAULT_ISOLATION_CONFIG,
  type TenantId,
  type TenantContext,
  type FederationConsentBypass,
  type IsolationLayer,
  type ViolationKind,
  type IsolationConfig,
} from './types.js';

// ============================================================================
// AsyncLocalStorage tenant context
// ============================================================================
export {
  runInTenantContext,
  getTenantContext,
  tryGetTenantContext,
  assertSameTenant,
  __resetTenantContextForTests,
} from './context/tenant-context.js';

// ============================================================================
// Hono middleware
// ============================================================================
export {
  honoTenantMiddleware,
  describeRejection,
  type HonoLike,
  type HonoNext,
  type DecodedJwt,
  type HonoTenantMiddlewareOptions,
} from './middleware/hono-tenant-middleware.js';

// ============================================================================
// Drizzle helper
// ============================================================================
export {
  tenantAwareQuery,
  TenantAwareQueryBuilder,
  type DrizzleLikeQueryBuilder,
  type TenantScopedTable,
  type EqFn,
  type TenantAwareQueryFactoryOptions,
} from './drizzle/tenant-aware-query.js';

// ============================================================================
// Redis wrapper
// ============================================================================
export {
  tenantKey,
  assertTenantPrefixedKey,
  wrapRedisWithTenantPrefix,
  type RedisLikeClient,
} from './redis/tenant-key-prefix.js';

// ============================================================================
// Storage wrapper
// ============================================================================
export {
  tenantPath,
  assertTenantPrefixedPath,
  wrapStorageWithTenantPrefix,
  type S3LikeClient,
  type ObjectArgs,
  type ListArgs,
} from './storage/tenant-path-prefix.js';

// ============================================================================
// Log scrubber
// ============================================================================
export {
  scrubLogEntry,
  deepScrubLogEntry,
  tenantScrubberRedactPaths,
  type ScrubbedEntry,
} from './logging/tenant-scrubber.js';

// ============================================================================
// Audit chain guard
// ============================================================================
export {
  assertTenantChainContinuity,
  assertTenantChainContinuitySync,
  type AuditChainEntry,
  type PrevHashLookup,
} from './audit/tenant-chain-guard.js';

// ============================================================================
// Leak scanner (programmatic)
// ============================================================================
export {
  scanRepo,
  listTypeScriptFiles,
  renderMarkdownReport,
  defaultScanOptions,
  type Finding,
  type Severity,
  type FindingKind,
  type ScanResult,
  type ScanOptions,
} from './scan/leak-scanner.js';
