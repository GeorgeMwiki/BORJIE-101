/**
 * @borjie/connector-slack — types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md` §4.1
 * and migration `0042_omni_p0_batch1.sql`.
 *
 * All records are immutable — every helper produces a new object,
 * never mutates an input. The connector boundary speaks two shapes:
 * a thin `SlackApiMessage` (provider payload) and a canonical
 * `SlackMessage` (post-redaction row matching the `slack_messages`
 * SQL table).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Ports — injected dependencies (no I/O in this package)
// ---------------------------------------------------------------------------

/**
 * Fetcher port. Tests inject a synthetic fixture; production wires
 * `globalThis.fetch`. The shape matches a *minimal* subset of WHATWG
 * fetch so the connector cannot accidentally rely on browser-only
 * surfaces.
 */
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

/**
 * Encryption-at-rest port for OAuth tokens. Production binds to a
 * KMS-backed AES-GCM helper. Tests inject an in-memory cipher.
 *
 * The connector NEVER stores plaintext — `seal` is called before
 * persistence; `open` is called only at the auth boundary.
 */
export interface CredentialCipher {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}

/**
 * Hasher port for boundary PII redaction. Tests inject a deterministic
 * hash; production wires WebCrypto / Node `crypto` sha256.
 */
export type Hasher = (input: string) => Promise<string>;

/**
 * Clock port — required for deterministic tests.
 */
export interface Clock {
  readonly nowIso: () => string;
}

/**
 * UUID generator port — required for deterministic tests.
 */
export interface UuidGen {
  readonly v4: () => string;
}

// ---------------------------------------------------------------------------
// Provider payload — what the Slack Web API returns
// ---------------------------------------------------------------------------

export interface SlackApiMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly ts: string;
  readonly user?: string;
  readonly text?: string;
  readonly thread_ts?: string;
  readonly reactions?: ReadonlyArray<SlackApiReaction>;
  readonly files?: ReadonlyArray<SlackApiFile>;
}

export interface SlackApiReaction {
  readonly name: string;
  readonly users: ReadonlyArray<string>;
  readonly count: number;
}

export interface SlackApiFile {
  readonly id: string;
  readonly name: string;
  readonly mimetype: string;
  readonly size: number;
  readonly url_private?: string;
}

// ---------------------------------------------------------------------------
// Canonical row — matches the slack_messages SQL table post-redaction
// ---------------------------------------------------------------------------

export interface SlackMessage {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly channel_id: string;
  readonly ts: string;
  readonly user_id: string | null;
  readonly text: string | null;
  readonly thread_ts: string | null;
  readonly reactions: ReadonlyArray<{
    readonly name: string;
    readonly count: number;
    readonly users: ReadonlyArray<string>;
  }>;
  readonly files: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly mimetype: string;
    readonly size: number;
    readonly storage_key: string | null;
  }>;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingested_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// OAuth + credentials
// ---------------------------------------------------------------------------

export interface SlackOAuthExchangeRequest {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface SlackOAuthTokens {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly scope: string;
  readonly bot_user_id: string;
  readonly team: { readonly id: string; readonly name: string };
  readonly enterprise: { readonly id: string; readonly name: string } | null;
  readonly authed_user: { readonly id: string };
  /**
   * Slack OAuth v2 only issues refresh tokens to apps that opt into
   * token rotation. We treat the field as optional and let
   * token-refresh.ts handle both branches.
   */
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

export interface StoredCredentials {
  readonly tenant_id: string;
  readonly connector_kind: 'slack';
  readonly connector_account: string;
  readonly access_token_enc: Uint8Array;
  readonly refresh_token_enc: Uint8Array | null;
  readonly scopes: ReadonlyArray<string>;
  readonly expires_at: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Sync request + result
// ---------------------------------------------------------------------------

export interface SlackSyncRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly cursor: string | null;
  readonly maxItems: number;
  readonly accessToken: string;
}

export type SlackSyncResult =
  | {
      readonly kind: 'ok';
      readonly messages: ReadonlyArray<SlackMessage>;
      readonly nextCursor: string | null;
    }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

// ---------------------------------------------------------------------------
// Zod schemas (callers validating untyped wire data)
// ---------------------------------------------------------------------------

export const slackOAuthTokensSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  scope: z.string(),
  bot_user_id: z.string(),
  team: z.object({ id: z.string(), name: z.string() }),
  enterprise: z
    .object({ id: z.string(), name: z.string() })
    .nullable(),
  authed_user: z.object({ id: z.string() }),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

export type SlackOAuthTokensValidated = z.infer<typeof slackOAuthTokensSchema>;
