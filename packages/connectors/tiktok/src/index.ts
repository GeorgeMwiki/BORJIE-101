/**
 * `@borjie/connector-tiktok` — public barrel.
 *
 * Wave OMNI-P2 #3 of 6. TikTok Business API ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.3.
 */

export type {
  TikTokKind,
  TikTokPost,
  TikTokInstall,
  FetcherPort,
  ClockPort,
  Logger,
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
  type RefreshOutcome,
  type EncryptedTokenStoragePort,
} from './auth/token-refresh.js';

export {
  listVideos,
  type ListVideosParams,
  type ListVideosResult,
} from './client/tiktok-client.js';

export {
  pollTikTok,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifyTikTokWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseVideo,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactCaption,
  redactFreeText,
  hashUsername,
  type RedactCaptionParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryTikTokPostsRepository,
  type TikTokPostsRepository,
} from './repositories/tiktok-posts-repository.js';
