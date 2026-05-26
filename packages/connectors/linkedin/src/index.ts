/**
 * `@borjie/connector-linkedin` — public barrel.
 *
 * Wave OMNI-P2 #5 of 6. LinkedIn Marketing API ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.5.
 */

export type {
  LinkedInKind,
  LinkedInPost,
  LinkedInInstall,
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
  listPosts,
  type ListPostsParams,
  type ListPostsResult,
} from './client/linkedin-client.js';

export {
  pollLinkedIn,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  normalisePost,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactCaption,
  redactFreeText,
  hashUrn,
  type RedactCaptionParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryLinkedInPostsRepository,
  type LinkedInPostsRepository,
} from './repositories/linkedin-posts-repository.js';
