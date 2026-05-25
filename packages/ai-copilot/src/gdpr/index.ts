/**
 * @borjie/ai-copilot / gdpr — Data-Subject Access Request compiler.
 *
 * Closes parity-gap G3 (BOSS RTBF lacked a data-export path). Sits beside
 * `services/domain-services/src/compliance/gdpr-service.ts` (which handles
 * the pseudonymisation / RTBF execution side); the compiler covers
 * GDPR Art. 20 portability + Tanzania PDPA s.27 access right.
 *
 * Surface stays minimal — one entrypoint (`compileDsar`) plus the port
 * types so the composition root can wire concrete data sources.
 */

export {
  compileDsar,
  createEmptyDsarDataSource,
  createNoopClassificationLookup,
  DSAR_BUNDLE_SCHEMA_VERSION,
  DSAR_TABLE_NAMES,
} from './dsar-compiler.js';

export type {
  ClassificationLevel as DsarClassificationLevel,
  ClassificationLookup as DsarClassificationLookup,
  FieldClassificationLite as DsarFieldClassificationLite,
  CompileDsarOptions,
  CompileDsarRequest,
  DsarBundle,
  DsarBundleSchemaVersion,
  DsarDataSource,
  DsarRow,
  DsarTableName,
} from './types.js';

// Drizzle-backed implementation of the `DsarDataSource` port. The
// composition root passes a Drizzle client + the database `classify`
// function and wires both into the compiler.
export {
  createDsarDataSourceDrizzle,
  createDatabaseClassificationLookup,
  DSAR_TABLE_BINDINGS,
} from './dsar-data-source-drizzle.js';

export type {
  CreateDsarDataSourceDrizzleOptions,
  DatabaseClassifyFn,
  DsarDrizzleClient,
  SqlTemplateFn,
} from './dsar-data-source-drizzle.js';

// Wave-K Final Zero — RTBF executor (GDPR Art. 17 / PDPA s.31). The
// composition root wires this against the live Drizzle client and the
// dsar router calls `executeRtbf` on every POST /:subjectId/rtbf.
export {
  createDsarRtbfExecutor,
  RTBF_POLICY,
} from './dsar-rtbf-executor.js';

export type {
  CreateDsarRtbfExecutorOptions,
  DsarRtbfExecutor,
  ExecuteRtbfArgs,
  RtbfAction,
  RtbfDrizzleClient,
  RtbfExecutionReport,
  RtbfPartialError,
  RtbfPolicyEntry,
  RtbfSqlTemplateFn,
  RtbfTableActionResult,
  RtbfTableReport,
} from './dsar-rtbf-executor.js';
