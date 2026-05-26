/**
 * `@borjie/connector-hubspot` — public barrel.
 *
 * Wave OMNI-P1 #2 of 9.
 */

export type {
  HubSpotObjectType,
  HubSpotObjectPayload,
  HubSpotInstall,
  SaltProvider,
  FetcherPort,
} from './types.js';

export {
  buildAuthorizeUrl,
  exchangeCode,
  type OAuth2AuthorizeParams,
  type OAuth2TokenResult,
  type OAuth2ExchangeParams,
} from './auth/oauth.js';

export {
  refreshAccessToken,
  type RefreshTokenParams,
  type EncryptedTokenStoragePort,
} from './auth/token-refresh.js';

export {
  searchObjects,
  type SearchParams,
  type SearchOutcome,
  type SearchResult,
  type SearchResultRow,
} from './client/hubspot-client.js';

export {
  pollHubSpot,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifyHubSpotWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseHubSpotRow,
  type NormaliseParams,
} from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  HUBSPOT_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryHubSpotRepository,
  type HubSpotRecordRow,
  type HubSpotRecordRepository,
} from './repositories/in-memory.js';

export {
  createSqlHubSpotRepository,
  type SqlExecutorPort,
} from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
