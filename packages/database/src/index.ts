/**
 * BORJIE Database Package
 * Database client, schemas, and repositories
 */

export {
  createDatabaseClient,
  createReadonlyDatabaseClient,
  withReservedConnection,
  type DatabaseClient,
} from './client.js';
// RLS per-operation tenant-context helpers — `withTenantContext` (tenant
// transaction + SET LOCAL) and `withServiceRoleContext` (cross-tenant system
// jobs). Now used across the gateway (brain thread store, calendar store,
// proactive scheduler, owner-docs) so they must be reachable from the barrel.
export {
  withTenantContext,
  withServiceRoleContext,
  type WithTenantContextOpts,
} from './rls/with-tenant-context.js';
export * from './schemas/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
export * from './security/data-classification.js';
// Phase D / A2b-1 — field-level encryption-at-rest composition entry
// point. Composition roots call `selectEncryptionPort(process.env)` and
// pass the returned port into every repository constructor.
export {
  selectEncryptionPort,
  selectEncryptionPortForTenant,
  encryptRow,
  decryptRow,
  decryptRows,
  getTenantRegion,
  ENCRYPTED_BLOB_PREFIX,
  EncryptionAuthenticationError,
  EncryptionKeyUnavailableError,
  type EncryptionPort,
  type FieldEncryptionAuditSink,
  type GetTenantRegionDb,
  type TenantRegionResolver,
} from './security/encryption/index.js';
export {
  createFieldEncryptionAuditService,
  type FieldEncryptionAuditService,
} from './services/field-encryption-audit.service.js';
// Phase D / A2b-1 — master-key rotation soak window guard.
export {
  recordKeyRotationStart,
  assertSafeToDropPreviousKey,
  loadMasterKeySnapshotWithSoakGuard,
  ROTATION_SOAK_WINDOW_MS,
  type RotationGuardDeps,
} from './security/encryption/key-rotation-soak-window.js';

// Wave CHAT-AS-OS-PARITY — universal `provenance` jsonb column factory.
export {
  provenanceColumn,
  type ProvenanceJson,
} from './helpers/provenance-column.js';
