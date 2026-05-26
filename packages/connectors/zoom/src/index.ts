/**
 * `@borjie/connector-zoom` — public barrel. Wave OMNI-P1 #8 of 9.
 */

export type { ZoomMeetingPayload, ZoomInstall, SaltProvider, FetcherPort } from './types.js';

export {
  fetchAccountAccessToken,
  type OAuth2TokenResult,
  type OAuth2ExchangeParams,
} from './auth/oauth.js';

export {
  getOrRefreshAccessToken,
  type RefreshTokenParams,
  type RefreshOutcome,
  type EncryptedTokenStoragePort,
} from './auth/token-refresh.js';

export {
  listPastMeetings,
  type ListMeetingsParams,
  type ZoomMeeting,
  type ListMeetingsOutcome,
} from './client/zoom-client.js';

export { pollZoom, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  verifyZoomWebhook,
  tryUrlValidationEcho,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
  type UrlValidationParams,
  type UrlValidationResponse,
} from './ingest/webhook-receiver.js';

export { normaliseZoomMeeting, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  ZOOM_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryZoomRepository,
  type ZoomMeetingRow,
  type ZoomMeetingRepository,
} from './repositories/in-memory.js';

export { createSqlZoomRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
