/**
 * `@borjie/connector-jira` — public barrel. Wave OMNI-P1 #4 of 9.
 */

export type {
  JiraEntityKind,
  JiraEntityPayload,
  JiraInstall,
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
  searchIssues,
  type SearchParams,
  type SearchIssue,
  type SearchResult,
  type SearchOutcome,
} from './client/jira-client.js';

export { pollJira, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  verifyJiraWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export { normaliseJiraIssue, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  JIRA_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryJiraRepository,
  type JiraRecordRow,
  type JiraRecordRepository,
} from './repositories/in-memory.js';

export { createSqlJiraRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
