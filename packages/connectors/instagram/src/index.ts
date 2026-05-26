/**
 * `@borjie/connector-instagram` — public barrel.
 *
 * Wave OMNI-P2 #1 of 6. Concrete Instagram Graph API ingest connector.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.1.
 */

export type {
  InstagramKind,
  InstagramPost,
  InstagramInstall,
  SaltProvider,
  FetcherPort,
  ClockPort,
  UuidPort,
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
  listMedia,
  type ListMediaParams,
  type ListMediaResult,
} from './client/instagram-client.js';

export {
  pollInstagram,
  type PollParams,
  type PollOutcome,
} from './ingest/poller.js';

export {
  verifyInstagramWebhook,
  type WebhookVerifyParams,
  type WebhookVerifyOutcome,
} from './ingest/webhook-receiver.js';

export {
  normaliseMedia,
  type NormalizeParams,
} from './ingest/normalizer.js';

export {
  redactCaption,
  redactFreeText,
  hashUsername,
  type RedactCaptionParams,
} from './redact/pii-redactor.js';

export {
  createInMemoryInstagramPostsRepository,
  type InstagramPostsRepository,
} from './repositories/instagram-posts-repository.js';
