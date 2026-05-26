/**
 * `@borjie/connector-salesforce` — public barrel.
 *
 * Wave OMNI-P1 #1 of 9. Concrete Salesforce ingest connector for
 * Mr. Mwikila's awareness substrate.
 */

export type {
  SalesforceSObjectType,
  SalesforceSObjectPayload,
  SalesforceInstall,
  SalesforcePushEvent,
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
  runSoqlQuery,
  type SoqlQueryParams,
  type SoqlQueryResult,
  type SoqlQueryOutcome,
  type SoqlQueryResultRecord,
} from './client/salesforce-client.js';

export {
  pollSalesforce,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifySalesforceWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseSalesforceRecord,
  type NormaliseParams,
} from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  SALESFORCE_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemorySalesforceRepository,
  type SalesforceRecordRow,
  type SalesforceRecordRepository,
} from './repositories/in-memory.js';

export {
  createSqlSalesforceRepository,
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
