/**
 * `@borjie/connector-email` — public surface (Wave OMNI-P0-BATCH-1).
 *
 * Concrete Gmail + Outlook mail connector. Spec:
 * `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.2.
 *
 * Two providers behind one canonical `EmailMessage` shape so
 * downstream code never branches on provider after the boundary.
 */

export type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
  CredentialCipher,
  Hasher,
  Clock,
  UuidGen,
  EmailProvider,
  GmailApiMessage,
  GmailApiMessagePart,
  OutlookApiMessage,
  EmailMessage,
  EmailOAuthExchangeRequest,
  EmailOAuthTokens,
  StoredEmailCredentials,
  EmailSyncRequest,
  EmailSyncResult,
} from './types.js';
export { emailOAuthTokensSchema } from './types.js';

export {
  createEmailOAuthExchange,
  type EmailOAuthExchangeDeps,
  type EmailOAuthExchangeResult,
} from './auth/oauth.js';
export {
  createTokenRefresher,
  TOKEN_REFRESH_MARGIN_MS,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type RefreshTokenDeps,
} from './auth/token-refresh.js';

export {
  createGmailClient,
  type GmailClient,
  type GmailClientDeps,
  type GmailListRequest,
  type GmailListResponse,
  type GmailGetResponse,
} from './client/gmail.js';
export {
  createOutlookGraphClient,
  type OutlookGraphClient,
  type OutlookGraphClientDeps,
  type OutlookListRequest,
  type OutlookListResponse,
} from './client/outlook-graph.js';

export {
  createEmailPoller,
  type EmailPoller,
  type EmailPollerDeps,
} from './ingest/poller.js';
export {
  createEmailNormaliser,
  type EmailNormaliser,
  type EmailNormaliserDeps,
  type NormaliseGmailRequest,
  type NormaliseOutlookRequest,
} from './ingest/normalizer.js';

export {
  createPiiRedactor,
  type PiiRedactor,
  type PiiRedactorDeps,
  type RedactInput,
  type RedactResult,
} from './redact/pii-redactor.js';

export {
  createInMemoryEmailMessagesRepository,
  type EmailMessagesRepository,
} from './repositories/messages.js';
export {
  createInMemoryEmailCredentialsRepository,
  type EmailCredentialsRepository,
} from './repositories/credentials.js';
export {
  createInMemoryCursorRepository,
  type CursorRepository,
  type CursorKey,
} from './repositories/cursors.js';
