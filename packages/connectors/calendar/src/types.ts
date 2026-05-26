/**
 * @borjie/connector-calendar — types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.3.
 *
 * Two providers behind one canonical `CalendarEvent` shape so
 * downstream code never branches on provider after the boundary.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface FetcherResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
}

export interface FetcherRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | undefined;
}

export type Fetcher = (req: FetcherRequest) => Promise<FetcherResponse>;

export interface CredentialCipher {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}

export type Hasher = (input: string) => Promise<string>;

export interface Clock {
  readonly nowIso: () => string;
}

export interface UuidGen {
  readonly v4: () => string;
}

// ---------------------------------------------------------------------------
// Provider discriminator + provider payloads
// ---------------------------------------------------------------------------

export type CalendarProvider = 'google_calendar' | 'outlook_calendar';

export interface GoogleApiEvent {
  readonly id: string;
  readonly status: string;
  readonly summary?: string;
  readonly description?: string;
  readonly start: { readonly dateTime?: string; readonly date?: string };
  readonly end: { readonly dateTime?: string; readonly date?: string };
  readonly attendees?: ReadonlyArray<{
    readonly email: string;
    readonly displayName?: string;
    readonly responseStatus?: string;
  }>;
  readonly location?: string;
  readonly originalStartTime?: { readonly dateTime?: string };
}

export interface OutlookApiEvent {
  readonly id: string;
  readonly subject: string;
  readonly bodyPreview: string;
  readonly start: { readonly dateTime: string; readonly timeZone: string };
  readonly end: { readonly dateTime: string; readonly timeZone: string };
  readonly attendees: ReadonlyArray<{
    readonly emailAddress: { readonly address: string; readonly name?: string };
    readonly status?: { readonly response: string };
  }>;
  readonly location?: { readonly displayName: string };
  readonly seriesMasterId?: string;
}

// ---------------------------------------------------------------------------
// Canonical row
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: CalendarProvider;
  readonly account: string;
  readonly calendar_id: string;
  readonly event_id: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly start_at: string | null;
  readonly end_at: string | null;
  readonly attendees: ReadonlyArray<{
    /** Salted-sha256 hash of the email address. */
    readonly email_hash: string;
    readonly response_status: string | null;
  }>;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingested_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// OAuth + credentials
// ---------------------------------------------------------------------------

export interface CalendarOAuthExchangeRequest {
  readonly provider: CalendarProvider;
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface CalendarOAuthTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: 'Bearer';
}

export interface StoredCalendarCredentials {
  readonly tenant_id: string;
  readonly connector_kind: CalendarProvider;
  readonly connector_account: string;
  readonly access_token_enc: Uint8Array;
  readonly refresh_token_enc: Uint8Array;
  readonly scopes: ReadonlyArray<string>;
  readonly expires_at: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Sync request + result
// ---------------------------------------------------------------------------

export interface CalendarSyncRequest {
  readonly tenantId: string;
  readonly provider: CalendarProvider;
  readonly account: string;
  readonly calendarId: string;
  readonly cursor: string | null;
  readonly maxItems: number;
  readonly accessToken: string;
}

export type CalendarSyncResult =
  | {
      readonly kind: 'ok';
      readonly events: ReadonlyArray<CalendarEvent>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'sync-token-reset' }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const calendarOAuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
  token_type: z.literal('Bearer'),
});
