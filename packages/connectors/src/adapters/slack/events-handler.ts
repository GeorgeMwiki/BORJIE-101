/**
 * Slack event-subscriptions handler.
 *
 * Front door for Slack's webhook POSTs. The router calls
 * `handleSlackEvent(rawBody, headers)`; the handler:
 *
 *   1. Verifies the request signature (per-tenant signing secret) via
 *      `signature-verifier`. Reject on any failure — Slack will retry.
 *   2. Parses the JSON envelope and discriminates on `type`.
 *   3. Handles the `url_verification` challenge by returning the
 *      `challenge` string the caller echoes back. This is the only
 *      response shape that's NOT 200-OK + empty body.
 *   4. For `event_callback`, dispatches the inner event to the
 *      brain-event emitter — fire and forget so the webhook can 200-OK
 *      Slack within the 3-second SLA.
 *
 * Tenant resolution: this handler is constructed for a SINGLE tenant
 * install. The composition root maintains a `Map<teamId, handler>` and
 * routes the inbound request to the correct handler by looking up the
 * `team_id` carried in the body. The handler additionally double-
 * checks the install's tenantId vs the envelope's team_id and rejects
 * on mismatch (defence-in-depth against router bugs).
 *
 * Why the handler doesn't talk to the network: it ONLY:
 *   - calls into the signature verifier (pure crypto)
 *   - calls into the brain-event emitter (which itself calls into the
 *     ACL resolver + publisher).
 *
 * No outbound HTTP. No file I/O. No environment lookups. The handler
 * is the thin glue between the wire format and the connector
 * components.
 */

import { verifySlackSignature } from './signature-verifier.js';
import type {
  SlackEventCallbackEnvelope,
  SlackEventEnvelope,
  SlackTenantInstall,
  SlackUrlVerificationEnvelope,
} from './types.js';
import type { SlackBrainEventEmitter } from './brain-event-emitter.js';

// ============================================================================
// Handler I/O types
// ============================================================================

/** Headers the handler reads. Case-insensitive lookup is the caller's job. */
export interface SlackEventHeaders {
  readonly 'x-slack-signature': string;
  readonly 'x-slack-request-timestamp': string;
}

/**
 * Discriminated outcome the caller translates into an HTTP response.
 *
 *   - `kind: 'challenge'` — respond 200 with `body: challenge` (plain
 *     text). Used for the `url_verification` handshake.
 *   - `kind: 'accepted'` — respond 200 with empty body. Brain emit is
 *     in-flight or already completed; the caller MUST NOT wait for it
 *     (Slack 3-second SLA).
 *   - `kind: 'rejected'` — respond with the suggested HTTP status.
 *     Slack will retry on 5xx; we use 4xx for signature failures so it
 *     doesn't.
 */
export type SlackHandleOutcome =
  | { readonly kind: 'challenge'; readonly challenge: string }
  | { readonly kind: 'accepted'; readonly publishedEvents: number }
  | { readonly kind: 'rejected'; readonly status: number; readonly reason: string };

// ============================================================================
// Handler options
// ============================================================================

export interface SlackEventsHandlerOptions {
  /** Per-tenant install — tokens + tenantId binding. */
  readonly install: SlackTenantInstall;
  /** The brain-event emitter for this tenant. */
  readonly emitter: SlackBrainEventEmitter;
  /**
   * Skew override for the signature verifier. Production: leave
   * default (5 minutes). Tests pass `Number.POSITIVE_INFINITY`.
   */
  readonly maxSkewSeconds?: number;
  /** Clock injection for tests. */
  readonly nowSeconds?: () => number;
  /** Optional logger for rejected requests. */
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg?: string): void;
  };
}

// ============================================================================
// Implementation
// ============================================================================

export class SlackEventsHandler {
  private readonly install: SlackTenantInstall;
  private readonly emitter: SlackBrainEventEmitter;
  private readonly maxSkewSeconds?: number;
  private readonly nowSeconds?: () => number;
  private readonly logger?: SlackEventsHandlerOptions['logger'];

  constructor(options: SlackEventsHandlerOptions) {
    this.install = options.install;
    this.emitter = options.emitter;
    if (options.maxSkewSeconds !== undefined) {
      this.maxSkewSeconds = options.maxSkewSeconds;
    }
    if (options.nowSeconds) {
      this.nowSeconds = options.nowSeconds;
    }
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  /**
   * Handle a single Slack event-subscriptions POST.
   *
   * `rawBody` MUST be the exact bytes Slack sent — captured BEFORE
   * any JSON.parse / middleware touches it. The signature is
   * computed over the raw bytes, so reserialising parsed JSON would
   * produce a different HMAC and fail verification.
   */
  async handle(rawBody: string, headers: SlackEventHeaders): Promise<SlackHandleOutcome> {
    // 1. Signature verification.
    const verify = verifySlackSignature(
      {
        rawBody,
        signature: headers['x-slack-signature'],
        timestamp: headers['x-slack-request-timestamp'],
        signingSecret: this.install.signingSecret,
      },
      {
        ...(this.maxSkewSeconds !== undefined ? { maxSkewSeconds: this.maxSkewSeconds } : {}),
        ...(this.nowSeconds ? { nowSeconds: this.nowSeconds } : {}),
      },
    );
    if (!verify.ok) {
      this.logger?.warn(
        { reason: verify.reason, teamId: this.install.teamId },
        'slack-events-handler: signature verification failed',
      );
      // 401 — Slack will NOT retry on 4xx.
      return { kind: 'rejected', status: 401, reason: verify.reason };
    }

    // 2. Parse the envelope.
    let envelope: SlackEventEnvelope;
    try {
      envelope = JSON.parse(rawBody) as SlackEventEnvelope;
    } catch {
      return { kind: 'rejected', status: 400, reason: 'malformed-json' };
    }

    // 3. Handshake or callback?
    if (envelope.type === 'url_verification') {
      return this.handleChallenge(envelope);
    }

    if (envelope.type === 'event_callback') {
      return this.handleCallback(envelope);
    }

    // Unknown top-level type — Slack docs say to 200 these too so
    // they don't retry. We log and accept.
    this.logger?.warn(
      { teamId: this.install.teamId, body: rawBody.slice(0, 200) },
      'slack-events-handler: unknown envelope type; accepting to suppress retry',
    );
    return { kind: 'accepted', publishedEvents: 0 };
  }

  private handleChallenge(envelope: SlackUrlVerificationEnvelope): SlackHandleOutcome {
    if (typeof envelope.challenge !== 'string' || envelope.challenge.length === 0) {
      return { kind: 'rejected', status: 400, reason: 'missing-challenge' };
    }
    return { kind: 'challenge', challenge: envelope.challenge };
  }

  private async handleCallback(envelope: SlackEventCallbackEnvelope): Promise<SlackHandleOutcome> {
    // Tenant isolation double-check.
    if (envelope.team_id !== this.install.teamId) {
      this.logger?.warn(
        {
          envelopeTeam: envelope.team_id,
          installTeam: this.install.teamId,
        },
        'slack-events-handler: cross-tenant envelope routed to wrong handler',
      );
      return { kind: 'rejected', status: 400, reason: 'tenant-mismatch' };
    }

    // Defensive: ensure we recognise the inner event type. Unknown
    // inner types accept-200 with zero published events (the emitter
    // already has an exhaustiveness check).
    const knownTypes = new Set<string>(['message', 'reaction_added', 'app_mention']);
    if (!envelope.event || !knownTypes.has(envelope.event.type)) {
      this.logger?.warn(
        {
          eventType: envelope.event?.type,
          teamId: this.install.teamId,
        },
        'slack-events-handler: unsubscribed inner event type; accepting to suppress retry',
      );
      return { kind: 'accepted', publishedEvents: 0 };
    }

    const published = await this.emitter.emitFromEnvelope(envelope);
    return { kind: 'accepted', publishedEvents: published };
  }
}

/** Factory function for composition root wiring. */
export function createSlackEventsHandler(
  options: SlackEventsHandlerOptions,
): SlackEventsHandler {
  return new SlackEventsHandler(options);
}
