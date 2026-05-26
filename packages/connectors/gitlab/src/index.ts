/**
 * `@borjie/connector-gitlab` — public barrel. Wave OMNI-P1 #6 of 9.
 */

export type {
  GitLabEntityKind,
  GitLabEntityPayload,
  GitLabInstall,
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
  type GitLabIssue,
  type ListIssuesOutcome,
} from './client/gitlab-client.js';

export { pollGitLab, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  verifyGitLabWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export { normaliseGitLabIssue, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  GITLAB_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryGitLabRepository,
  type GitLabRecordRow,
  type GitLabRecordRepository,
} from './repositories/in-memory.js';

export { createSqlGitLabRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
