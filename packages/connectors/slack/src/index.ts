/**
 * `@borjie/connector-slack` — public surface (Wave OMNI-P0-BATCH-1).
 *
 * Concrete Slack connector for Mr. Mwikila's external-data spine.
 * Spec: `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.1.
 *
 * The connector binds to `slack_messages` / `connector_credentials` /
 * `connector_cursors` from migration `0042_omni_p0_batch1.sql` and
 * feeds canonical rows into the cognitive-memory `observe` boundary.
 *
 * Every external HTTP call goes through an injected `Fetcher` port
 * so tests run offline against synthetic fixtures.
 */

// Types
export type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
  CredentialCipher,
  Hasher,
  Clock,
  UuidGen,
  SlackApiMessage,
  SlackApiReaction,
  SlackApiFile,
  SlackMessage,
  SlackOAuthExchangeRequest,
  SlackOAuthTokens,
  SlackOAuthTokensValidated,
  StoredCredentials,
  SlackSyncRequest,
  SlackSyncResult,
} from './types.js';
export { slackOAuthTokensSchema } from './types.js';

// Auth
export {
  createSlackOAuthExchange,
  type SlackOAuthExchangeDeps,
  type SlackOAuthExchangeResult,
} from './auth/oauth.js';
export {
  createTokenRefresher,
  TOKEN_REFRESH_MARGIN_MS,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type RefreshTokenDeps,
} from './auth/token-refresh.js';

// Client
export {
  createSlackWebClient,
  type SlackHistoryRequest,
  type SlackHistoryResponse,
  type SlackWebClient,
  type SlackWebClientDeps,
} from './client/slack-web.js';

// Ingest
export {
  createSlackPoller,
  type SlackPoller,
  type SlackPollerDeps,
} from './ingest/poller.js';
export {
  createSlackNormaliser,
  type SlackNormaliser,
  type SlackNormaliserDeps,
  type NormaliseRequest,
} from './ingest/normalizer.js';

// Redact
export {
  createPiiRedactor,
  type PiiRedactor,
  type PiiRedactorDeps,
  type RedactInput,
  type RedactResult,
} from './redact/pii-redactor.js';

// Repositories
export {
  createInMemorySlackMessagesRepository,
  type SlackMessagesRepository,
} from './repositories/messages.js';
export {
  createInMemoryCredentialsRepository,
  type CredentialsRepository,
} from './repositories/credentials.js';
export {
  createInMemoryCursorRepository,
  type CursorRepository,
  type CursorKey,
} from './repositories/cursors.js';
