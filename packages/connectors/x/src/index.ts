/**
 * `@borjie/connector-x` — public barrel.
 *
 * Wave OMNI-P2 #4 of 6. X API v2 (formerly Twitter) ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.4.
 */

export type {
  XKind,
  XPost,
  XInstall,
  FetcherPort,
  ClockPort,
  Logger,
} from './types.js';

export {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  type OAuth2AuthorizeParams,
  type OAuth2TokenResult,
  type OAuth2ExchangeParams,
  type PkceChallenge,
} from './auth/oauth.js';

export {
  refreshAccessToken,
  type RefreshTokenParams,
  type RefreshOutcome,
  type EncryptedTokenStoragePort,
} from './auth/token-refresh.js';

export {
  listTweets,
  listMentions,
  type ListTweetsParams,
  type ListTweetsResult,
} from './client/x-client.js';

export {
  pollX,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  normaliseTweet,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactTweetText,
  redactFreeText,
  hashUsername,
  type RedactTextParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryXPostsRepository,
  type XPostsRepository,
} from './repositories/x-posts-repository.js';
