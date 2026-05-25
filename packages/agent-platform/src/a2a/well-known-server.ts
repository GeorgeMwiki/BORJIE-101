/**
 * A2A `/.well-known/agent.json` server.
 *
 * Per the A2A spec, every agent host exposes its Agent Card at the path
 * `/.well-known/agent.json` so that consumers can discover it without
 * out-of-band configuration.
 *
 * This module is framework-agnostic — it returns a `WellKnownResponse` that
 * the api-gateway can render with whatever HTTP library it uses
 * (Hono / Fastify / Express / Cloudflare Workers).
 */
import {
  serializeAgentCard,
  type A2AAgentCard,
} from './agent-card.js';
import {
  signAgentCard,
  type A2ASigningKey,
} from './agent-card-signer.js';

export interface WellKnownResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface WellKnownServerDeps {
  /** The unsigned Agent Card for this org. */
  readonly card: A2AAgentCard;
  /** Optional signing key — if present, every served card is signed. */
  readonly signingKey?: A2ASigningKey;
  /** Optional cache control in seconds. Defaults to 5 minutes. */
  readonly cacheMaxAgeSeconds?: number;
  /** Test override for the current time used in the signature block. */
  readonly now?: () => Date;
}

/**
 * Build a response for `GET /.well-known/agent.json`.
 *
 * Signs the card on every request when a `signingKey` is supplied so that
 * the `signedAt` timestamp inside the signature block stays fresh. If you
 * want to cache, sign once and call `serveAgentCardStatic`.
 */
export async function serveAgentCard(
  deps: WellKnownServerDeps,
): Promise<WellKnownResponse> {
  const card = deps.signingKey
    ? await signAgentCard(deps.card, {
        key: deps.signingKey,
        ...(deps.now ? { now: deps.now } : {}),
      })
    : deps.card;
  return serveAgentCardStatic(card, deps.cacheMaxAgeSeconds);
}

/**
 * Serve a pre-signed Agent Card. Use when you cache the signed card and
 * want to skip resigning on every request.
 */
export function serveAgentCardStatic(
  card: A2AAgentCard,
  cacheMaxAgeSeconds = 300,
): WellKnownResponse {
  return Object.freeze({
    status: 200,
    headers: Object.freeze({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${Math.max(0, Math.floor(cacheMaxAgeSeconds))}`,
      'X-A2A-Spec-Version': '1.0',
    }),
    body: serializeAgentCard(card),
  });
}
