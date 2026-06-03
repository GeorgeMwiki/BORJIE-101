/**
 * Channel gateway — inbound canonicalization (LP-25).
 *
 * `createChannelGateway` wires the signature verifier + tier resolver to the
 * per-channel canonicalizers and exposes a single `canonicalize` entry point
 * the connector routes use. The result is a verified, tier-resolved
 * {@link ChannelEvent} or a typed rejection.
 *
 * Order of operations (security-first):
 *   1. Verify the provider signature on the RAW body. Fail -> reject. We do
 *      this BEFORE parsing so a forged payload never reaches the brain.
 *   2. Canonicalize the parsed payload to a draft.
 *   3. Resolve the sender to a tenant + actor + tier (fail-soft anonymous).
 *   4. Emit the frozen ChannelEvent.
 *
 * @module @borjie/channel-gateway/gateway
 */

import type {
  CanonicalizeResult,
  ChannelEvent,
  ChannelKind,
} from './types.js';
import { canonicalizeByChannel } from './canonicalizers.js';
import {
  systemClock,
  type Clock,
  type SignatureVerifier,
  type TierResolver,
} from './ports.js';

export interface ChannelGatewayDeps {
  readonly signature: SignatureVerifier;
  readonly tier: TierResolver;
  readonly clock?: Clock;
}

export interface CanonicalizeInput {
  readonly channel: ChannelKind;
  /** Raw request body exactly as received (for signature verification). */
  readonly rawBody: string;
  /** Lower-cased provider headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed payload object the connector extracted from `rawBody`. */
  readonly payload: unknown;
}

export interface ChannelGateway {
  canonicalize(input: CanonicalizeInput): Promise<CanonicalizeResult>;
}

export function createChannelGateway(deps: ChannelGatewayDeps): ChannelGateway {
  const clock = deps.clock ?? systemClock;

  const canonicalize = async (input: CanonicalizeInput): Promise<CanonicalizeResult> => {
    // 1. Signature first, on the raw body. Fail-closed.
    let verified = false;
    try {
      verified = await deps.signature.verify({
        channel: input.channel,
        rawBody: input.rawBody,
        headers: input.headers,
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      return {
        ok: false,
        reason: 'signature_invalid',
        detail: `signature verification failed for ${input.channel}`,
      };
    }

    // 2. Canonicalize the parsed payload.
    const draft = canonicalizeByChannel(input.channel, input.payload);
    if (!draft) {
      return {
        ok: false,
        reason: 'unsupported_payload',
        detail: `no canonicalizer for channel ${input.channel}`,
      };
    }

    // A draft with neither text nor attachments nor a resolvable sender is
    // not actionable — most often a delivery-receipt / status webhook.
    const hasSenderKey =
      Boolean(draft.rawSender.phone) ||
      Boolean(draft.rawSender.email) ||
      Boolean(draft.rawSender.webUserId);
    if (!hasSenderKey && draft.text.length === 0 && draft.attachments.length === 0) {
      return {
        ok: false,
        reason: 'malformed',
        detail: `empty/non-message payload on ${input.channel}`,
      };
    }

    // 3. Resolve sender -> tier (fail-soft anonymous).
    let resolved: Awaited<ReturnType<TierResolver['resolve']>>;
    try {
      resolved = await deps.tier.resolve(draft.rawSender);
    } catch {
      resolved = { tenantId: null, actorId: null, tier: 'anonymous' };
    }

    // 4. Emit the frozen canonical event.
    const event: ChannelEvent = Object.freeze({
      eventId: draft.eventId,
      channel: input.channel,
      sender: Object.freeze({
        raw: draft.rawSender,
        tenantId: resolved.tenantId,
        actorId: resolved.actorId,
        tier: resolved.tier,
      }),
      text: draft.text,
      attachments: Object.freeze([...draft.attachments]),
      receivedAt: clock.now().toISOString(),
      metadata: draft.metadata,
      signatureVerified: true,
    });

    return { ok: true, event };
  };

  return { canonicalize };
}
