/**
 * `@borjie/connector-teams` — public barrel. Wave OMNI-P1 #7 of 9.
 */

export type { TeamsMessagePayload, TeamsInstall, SaltProvider, FetcherPort } from './types.js';

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
  listChannelMessages,
  type ListMessagesParams,
  type GraphMessage,
  type ListMessagesOutcome,
} from './client/teams-client.js';

export { pollTeams, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  tryValidationEcho,
  verifyTeamsClientState,
  type ValidationParams,
  type VerifyClientStateParams,
  type VerifyOutcome,
} from './ingest/webhook-receiver.js';

export { normaliseTeamsMessage, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  TEAMS_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryTeamsRepository,
  type TeamsMessageRow,
  type TeamsMessageRepository,
} from './repositories/in-memory.js';

export { createSqlTeamsRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
