/**
 * `@borjie/connector-youtube` — public barrel.
 *
 * Wave OMNI-P2 #6 of 6. YouTube Data API v3 ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.6.
 */

export type {
  YouTubeVideo,
  YouTubeInstall,
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
  searchChannelVideos,
  videosList,
  type ListChannelVideosParams,
  type ListChannelVideosResult,
  type VideosListParams,
  type VideosListResult,
} from './client/youtube-client.js';

export {
  pollYouTube,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifySubscription,
  verifyPushBody,
  type VerifyChallengeParams,
  type VerifyChallengeOutcome,
  type VerifyBodyParams,
  type VerifyBodyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseVideo,
  parseIso8601Duration,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactDescription,
  redactFreeText,
  hashChannelId,
  type RedactDescriptionParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryYouTubeVideosRepository,
  type YouTubeVideosRepository,
} from './repositories/youtube-videos-repository.js';
