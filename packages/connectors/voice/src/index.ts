/**
 * `@borjie/connector-voice` — public barrel. Wave OMNI-P1 #9 of 9.
 *
 * Twilio Voice via a DEDICATED sub-account (TWILIO_VOICE_SUBACCOUNT_SID),
 * distinct from the SMS notifier in services/wave-resilience-manager.
 */

export type {
  VoiceCallPayload,
  CallDirection,
  TwilioInstall,
  SaltProvider,
  FetcherPort,
} from './types.js';

export {
  assembleBasicAuth,
  SubAccountIsolationError,
  type BasicAuthResult,
  type AssembleAuthParams,
} from './auth/oauth.js';

export {
  refreshAccessToken,
  type RefreshTokenParams,
  type RefreshOutcome,
  type EncryptedTokenStoragePort,
} from './auth/token-refresh.js';

export {
  listCalls,
  type ListCallsParams,
  type TwilioCall,
  type ListCallsOutcome,
} from './client/voice-client.js';

export { pollVoiceCalls, type PollParams, type PollOutcome } from './ingest/poller.js';

export {
  verifyTwilioSignature,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
  type WebhookBody,
} from './ingest/webhook-receiver.js';

export { normaliseVoiceCall, type NormaliseParams } from './ingest/normalizer.js';

export {
  createSaltedHashRedactor,
  VOICE_PII_FIELDS,
  type SaltedHashRedactor,
  type SaltedHashRedactorDeps,
} from './redact/pii-redactor.js';

export {
  createInMemoryVoiceRepository,
  type VoiceCallRow,
  type VoiceCallRepository,
} from './repositories/in-memory.js';

export { createSqlVoiceRepository, type SqlExecutorPort } from './repositories/sql.js';

export {
  createLogger,
  type Logger,
  type LogEmitter,
  type LogLevel,
  type ServiceIdentity,
  type TelemetryConfig,
  type CreateLoggerDeps,
} from './logger.js';
