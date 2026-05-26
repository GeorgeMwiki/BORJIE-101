/**
 * `@borjie/connector-github` — public barrel. Wave OMNI-P1 #5 of 9.
 */

export type {
  GitHubEntityKind,
  GitHubEntityPayload,
  GitHubInstall,
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
  listIssues,
  type ListIssuesParams,
  type GitHubIssue,
  type ListIssuesOutcome,
} from './client/github-client.js';

export { pollGitHub, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  verifyGitHubWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export { normaliseGitHubIssue, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  GITHUB_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryGitHubRepository,
  type GitHubRecordRow,
  type GitHubRecordRepository,
} from './repositories/in-memory.js';

export { createSqlGitHubRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
