/**
 * Channel gateway — injected ports (LP-25).
 *
 * Canonicalization and state-sync are pure; everything with a side effect or
 * a secret is a port the host wires. No Supabase / HMAC-secret / HTTP import
 * lives in this package.
 *
 * @module @borjie/channel-gateway/ports
 */

import type {
  ActorTier,
  ChannelKind,
  ConversationState,
  RawSender,
} from './types.js';

// ----------------------------------------------------------------------------
// Signature verification
// ----------------------------------------------------------------------------

/** What a connector hands the verifier: the raw body + the provider headers. */
export interface SignatureInput {
  readonly channel: ChannelKind;
  /** Exact raw request body bytes/text as received (pre-JSON-parse). */
  readonly rawBody: string;
  /** Lower-cased header map. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Verifies a provider webhook signature. The host injects the real HMAC /
 * token check per provider (Meta `X-Hub-Signature-256`, Africa's Talking
 * HMAC-SHA1, Twilio `X-Twilio-Signature`, etc.) using secrets from its
 * bootstrap config. Returns `true` only on a passing signature.
 *
 * SECURITY: fail-closed. An unknown channel or a missing secret returns
 * `false` so an unsigned event is rejected, never trusted.
 */
export interface SignatureVerifier {
  verify(input: SignatureInput): boolean | Promise<boolean>;
}

// ----------------------------------------------------------------------------
// Sender -> tier resolution
// ----------------------------------------------------------------------------

/**
 * Maps a channel-native sender to a tenant + actor + tier. The host queries
 * the member directory (phone / email / web-subject -> member). NEVER
 * throws: an unresolved sender returns `tier: 'anonymous'` with null scope.
 */
export interface TierResolver {
  resolve(sender: RawSender): Promise<{
    readonly tenantId: string | null;
    readonly actorId: string | null;
    readonly tier: ActorTier;
  }>;
}

// ----------------------------------------------------------------------------
// Cross-channel state store
// ----------------------------------------------------------------------------

/**
 * Persistence for cross-channel conversation state. Backed by Redis/Upstash
 * in production (with a TTL) or an in-memory map in tests. Updates are
 * immutable: `put` overwrites with a fresh object the caller built.
 */
export interface ConversationStore {
  get(conversationId: string): Promise<ConversationState | null>;
  put(state: ConversationState): Promise<void>;
  /** Best-effort delete (e.g. on conversation close). */
  remove(conversationId: string): Promise<void>;
}

// ----------------------------------------------------------------------------
// SSRF-safe remote fetch
// ----------------------------------------------------------------------------

export interface SafeFetchResult {
  readonly ok: boolean;
  readonly status: number;
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
  readonly reason?: string;
}

/**
 * SSRF-guarded fetch for provider-hosted attachment URLs (WhatsApp media,
 * email attachment links). The host injects a validator that resolves DNS,
 * rejects private ranges / rebind pivots, and bounds size + timeout. This
 * package NEVER calls bare `fetch` on a remote URL.
 */
export interface SafeFetchPort {
  fetch(url: string, options?: { readonly maxBytes?: number; readonly timeoutMs?: number }): Promise<SafeFetchResult>;
}

// ----------------------------------------------------------------------------
// Clock
// ----------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
