/**
 * @borjie/connector-email — types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.2.
 *
 * `EmailProvider` is the discriminator that selects which client
 * implementation (Gmail or Outlook Graph) the orchestrator routes
 * through. The canonical row `EmailMessage` is uniform across
 * providers — the normalisers flatten provider-specific shapes into
 * it.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Ports — injected dependencies (no I/O in this package)
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

export type EmailProvider = 'gmail' | 'outlook_mail';

export interface GmailApiMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: ReadonlyArray<string>;
  readonly snippet: string;
  readonly payload: {
    readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>;
    readonly mimeType: string;
    readonly body?: { readonly data?: string; readonly size?: number };
    readonly parts?: ReadonlyArray<GmailApiMessagePart>;
  };
}

export interface GmailApiMessagePart {
  readonly mimeType: string;
  readonly filename: string;
  readonly body?: {
    readonly data?: string;
    readonly attachmentId?: string;
    readonly size?: number;
  };
  readonly parts?: ReadonlyArray<GmailApiMessagePart>;
}

export interface OutlookApiMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly subject: string;
  readonly bodyPreview: string;
  readonly from?: { readonly emailAddress: { readonly address: string; readonly name?: string } };
  readonly toRecipients: ReadonlyArray<{
    readonly emailAddress: { readonly address: string; readonly name?: string };
  }>;
  readonly body: { readonly contentType: 'html' | 'text'; readonly content: string };
  readonly hasAttachments: boolean;
  readonly receivedDateTime: string;
}

// ---------------------------------------------------------------------------
// Canonical row — matches `email_messages` table post-redaction
// ---------------------------------------------------------------------------

export interface EmailMessage {
  readonly id: string;
  readonly tenant_id: string;
  readonly provider: EmailProvider;
  readonly account: string;
  readonly message_id: string;
  readonly thread_id: string | null;
  /** Post-redaction salted-sha256 hash. */
  readonly from_addr: string | null;
  /** Post-redaction salted-sha256 hashes. */
  readonly to_addrs: ReadonlyArray<string>;
  readonly subject: string | null;
  readonly body_text: string | null;
  readonly body_html: string | null;
  readonly attachments: ReadonlyArray<{
    readonly name: string;
    readonly mimetype: string;
    readonly size: number;
    readonly storage_key: string | null;
    readonly content_hash: string | null;
  }>;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingested_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// OAuth + credentials
// ---------------------------------------------------------------------------

export interface EmailOAuthExchangeRequest {
  readonly provider: EmailProvider;
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface EmailOAuthTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: 'Bearer';
}

export interface StoredEmailCredentials {
  readonly tenant_id: string;
  readonly connector_kind: EmailProvider;
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

export interface EmailSyncRequest {
  readonly tenantId: string;
  readonly provider: EmailProvider;
  readonly account: string;
  readonly cursor: string | null;
  readonly maxItems: number;
  readonly accessToken: string;
  /** Label / category filter — empty array means all matches. */
  readonly labels: ReadonlyArray<string>;
}

export type EmailSyncResult =
  | {
      readonly kind: 'ok';
      readonly messages: ReadonlyArray<EmailMessage>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const emailOAuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
  token_type: z.literal('Bearer'),
});
