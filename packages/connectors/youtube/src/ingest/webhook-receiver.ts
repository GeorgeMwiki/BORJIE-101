/**
 * YouTube PubSubHubbub (PuSH) webhook receiver.
 *
 * Reference: Google Developers, *Push Notifications for YouTube
 * Channels*,
 * https://developers.google.com/youtube/v3/guides/push_notifications,
 * accessed 2026-05-25.
 *
 * Two surfaces:
 *   - Subscription verification: GET with `hub.challenge`/`hub.mode`
 *     query — return the challenge string verbatim if mode == 'subscribe'.
 *   - Body authenticity: optional HMAC-SHA1 via `X-Hub-Signature`
 *     header (PuSH protocol). We support the SHA1 form because that's
 *     what PubSubHubbub mandates.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyChallengeParams {
  readonly mode: string;
  readonly challenge: string;
  readonly topic: string;
  readonly expectedTopic: string;
}

export interface VerifyChallengeOutcome {
  readonly accept: boolean;
  readonly challengeResponse?: string;
  readonly reason?: string;
}

export function verifySubscription(
  params: VerifyChallengeParams,
): VerifyChallengeOutcome {
  if (params.mode !== 'subscribe' && params.mode !== 'unsubscribe') {
    return Object.freeze({ accept: false, reason: 'unknown mode' });
  }
  if (params.topic !== params.expectedTopic) {
    return Object.freeze({ accept: false, reason: 'topic mismatch' });
  }
  return Object.freeze({ accept: true, challengeResponse: params.challenge });
}

export interface VerifyBodyParams {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly secret: string;
}

export interface VerifyBodyOutcome {
  readonly valid: boolean;
  readonly reason?: string;
}

const SIG_HEADER = 'x-hub-signature';

export function verifyPushBody(params: VerifyBodyParams): VerifyBodyOutcome {
  const sig = lookupHeader(params.headers, SIG_HEADER);
  if (!sig) {
    return Object.freeze({ valid: false, reason: 'missing signature header' });
  }
  const prefix = 'sha1=';
  if (!sig.startsWith(prefix)) {
    return Object.freeze({ valid: false, reason: 'bad signature prefix' });
  }
  const expected = createHmac('sha1', params.secret)
    .update(params.body)
    .digest('hex');
  const a = Buffer.from(sig.slice(prefix.length), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) {
    return Object.freeze({ valid: false, reason: 'length mismatch' });
  }
  const ok = timingSafeEqual(a, b);
  return Object.freeze({
    valid: ok,
    ...(ok ? {} : { reason: 'hmac mismatch' }),
  });
}

function lookupHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return v ?? null;
    }
  }
  return null;
}
