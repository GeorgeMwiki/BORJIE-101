/**
 * `@borjie/connector-linear` — public barrel. Wave OMNI-P1 #3 of 9.
 */

export type {
  LinearEntityKind,
  LinearEntityPayload,
  LinearInstall,
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
  runGraphQLQuery,
  type GraphQLQueryParams,
  type GraphQLQueryResult,
  type GraphQLOutcome,
} from './client/linear-client.js';

export {
  pollLinear,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifyLinearWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseLinearNode,
  type LinearIssueNode,
  type NormaliseParams,
} from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  LINEAR_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryLinearRepository,
  type LinearRecordRow,
  type LinearRecordRepository,
} from './repositories/in-memory.js';

export {
  createSqlLinearRepository,
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
