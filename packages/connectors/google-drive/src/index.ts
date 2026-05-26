/**
 * @borjie/connector-google-drive — public surface.
 *
 * OMNI-P0-BATCH-2. Google Drive (files / folders / comments) ingest
 * with native plain-text export for gdoc / gsheet / gslide.
 *
 * Companion spec: `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §5.
 *
 * Persona: Mr. Mwikila.
 */

export type {
  Provider,
  NativeMimeType,
  DriveFile,
  DriveUpstreamFile,
  DriveChangeRow,
  DriveChangesResponse,
  DriveStartPageTokenResponse,
  DriveCommentsResponse,
  Fetcher,
  EncryptedCredentialStore,
  ConnectorLogger,
} from './types.js';
export {
  PROVIDER,
  NATIVE_DOC_MIME,
  NATIVE_SHEET_MIME,
  NATIVE_SLIDE_MIME,
} from './types.js';

export {
  exchangeDriveAuthCode,
  SCOPES_READONLY,
  TOKEN_URL,
  type DriveOAuthExchangeInput,
  type DriveTokenResponse,
  type DriveCredentials,
  type DriveInstallDeps,
} from './auth/oauth.js';

export {
  refreshDriveAccessToken,
  type DriveRefreshInput,
  type DriveRefreshDeps,
  type DriveRefreshOutcome,
} from './auth/token-refresh.js';

export {
  createDriveHttpClient,
  type DriveHttpClient,
  type DriveHttpDeps,
} from './client/http-client.js';

export {
  redactValue,
  type RedactInput,
} from './redact/pii-redactor.js';

export {
  extractDriveText,
  isNativeWorkspaceMime,
  type ExtractInput,
} from './extract/text-extractor.js';

export {
  normalizeDriveFile,
  type DriveNormalizerDeps,
  type NormalizedDriveFile,
} from './ingest/normalizer.js';

export {
  pollDriveChanges,
  type DrivePollInput,
  type DrivePollDeps,
  type DrivePollOutcome,
} from './ingest/poller.js';

export {
  receiveDriveWebhook,
  type DriveWebhookResult,
} from './ingest/webhook-receiver.js';

export {
  createInMemoryDriveRepository,
  type DriveRepository,
} from './repositories/in-memory.js';

export {
  createSqlDriveRepository,
  type DriveSqlDeps,
} from './repositories/sql.js';
