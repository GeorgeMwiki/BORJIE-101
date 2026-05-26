/**
 * `@borjie/connector-calendar` — public surface (Wave OMNI-P0-BATCH-1).
 *
 * Google Calendar + Outlook Calendar connector. Spec:
 * `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.3.
 */

export type {
  Fetcher,
  FetcherRequest,
  FetcherResponse,
  CredentialCipher,
  Hasher,
  Clock,
  UuidGen,
  CalendarProvider,
  GoogleApiEvent,
  OutlookApiEvent,
  CalendarEvent,
  CalendarOAuthExchangeRequest,
  CalendarOAuthTokens,
  StoredCalendarCredentials,
  CalendarSyncRequest,
  CalendarSyncResult,
} from './types.js';
export { calendarOAuthTokensSchema } from './types.js';

export {
  createCalendarOAuthExchange,
  type CalendarOAuthExchangeDeps,
  type CalendarOAuthExchangeResult,
} from './auth/oauth.js';
export {
  createTokenRefresher,
  TOKEN_REFRESH_MARGIN_MS,
  type RefreshTokenInput,
  type RefreshTokenResult,
  type RefreshTokenDeps,
} from './auth/token-refresh.js';

export {
  createGoogleCalendarClient,
  type GoogleCalendarClient,
  type GoogleCalClientDeps,
  type GoogleEventsRequest,
  type GoogleEventsResponse,
} from './client/google-cal-api.js';
export {
  createOutlookCalendarClient,
  type OutlookCalendarClient,
  type OutlookCalClientDeps,
  type OutlookEventsRequest,
  type OutlookEventsResponse,
} from './client/outlook-graph.js';

export {
  createCalendarPoller,
  type CalendarPoller,
  type CalendarPollerDeps,
} from './ingest/poller.js';
export {
  createCalendarNormaliser,
  type CalendarNormaliser,
  type CalendarNormaliserDeps,
  type NormaliseGoogleRequest,
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
  createInMemoryCalendarEventsRepository,
  type CalendarEventsRepository,
} from './repositories/messages.js';
export {
  createInMemoryCalendarCredentialsRepository,
  type CalendarCredentialsRepository,
} from './repositories/credentials.js';
export {
  createInMemoryCursorRepository,
  type CursorRepository,
  type CursorKey,
} from './repositories/cursors.js';
