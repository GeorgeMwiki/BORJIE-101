/**
 * `@borjie/connector-facebook` — public barrel.
 *
 * Wave OMNI-P2 #2 of 6. Facebook Page Graph API ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.2.
 */

export type {
  FacebookKind,
  FacebookPost,
  FacebookInstall,
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
} from './client/facebook-client.js';

export {
  pollFacebook,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifyFacebookWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normalisePost,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactMessage,
  redactFreeText,
  hashHandle,
  type RedactMessageParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryFacebookPostsRepository,
  type FacebookPostsRepository,
} from './repositories/facebook-posts-repository.js';
