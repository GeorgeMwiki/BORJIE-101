/**
 * POST /voice/calls/start
 *
 * Mints a fresh session id + WebSocket URL the caller's client uses to push
 * audio frames upstream. This route is intentionally minimal — the actual
 * audio brokering happens on the WS channel; this handler just picks STT /
 * TTS providers up-front so the WS connect handshake can short-circuit.
 *
 * Telephony bridge (Twilio / SIP) is OUT OF SCOPE for this service. A
 * downstream service is expected to convert call legs into the WS protocol
 * described here.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  recordSecurityEvent,
  withSecurityEventsFastify,
} from '@borjie/observability';
import { requireUser } from '../middleware/auth.js';
import { detectLanguage } from '../router/language-router.js';
import { routeStt } from '../router/stt-router.js';
import { routeTts, type LatencyTier } from '../router/tts-router.js';

// `tenantId` is intentionally NOT in the body schema — it is derived
// from the verified JWT (see `requireUser`). A separate `bodyTenantId`
// field stays optional for backwards-compat with older mobile builds;
// when it disagrees with the session tenant we emit a security event
// and use the session value (never the body). Closes the
// write-to-wrong-tenant risk surfaced in P75 / P86 closure (CWE-285).
const BodySchema = z.object({
  /** Deprecated — ignored. Kept optional so older clients keep parsing. */
  tenantId: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  /** Caller's E.164 phone number, if known. */
  callerE164: z.string().min(1).optional(),
  /** ISO-3166 alpha-2 jurisdiction (defaults to TZ at the persona layer). */
  jurisdiction: z.string().length(2).optional(),
  latencyTier: z.enum(['best-quality', 'low-latency']).optional(),
});

export type StartCallBody = z.infer<typeof BodySchema>;

export interface StartCallResponse {
  readonly sessionId: string;
  readonly wsUrl: string;
  readonly language: string;
  readonly stt: { readonly provider: string; readonly rationale: string };
  readonly tts: { readonly provider: string; readonly rationale: string };
}

export interface CallRouteOptions {
  /**
   * Origin used to build the absolute WebSocket URL returned to the client.
   * Defaults to `ws://${host}:${port}` derived from the request — but in
   * production the gateway / ingress hostname should be passed explicitly so
   * the URL is stable across pod restarts.
   */
  readonly wsBaseUrl?: string;
}

/**
 * Pure helper — exposed for unit tests. Resolves the routing decisions and
 * mints the session metadata without touching the HTTP framework.
 */
export function planCall(
  body: StartCallBody,
  options: { wsBaseUrl: string },
): StartCallResponse {
  const language = detectLanguage(body.language);
  const tier: LatencyTier = body.latencyTier ?? 'best-quality';
  const stt = routeStt(language);
  const tts = routeTts(language, tier);
  const sessionId = randomUUID();
  const wsUrl = `${options.wsBaseUrl.replace(/\/$/, '')}/voice/calls/${sessionId}/stream`;

  return {
    sessionId,
    wsUrl,
    language,
    stt: { provider: stt.provider, rationale: stt.rationale },
    tts: { provider: tts.provider, rationale: tts.rationale },
  };
}

export function registerCallRoute(
  app: FastifyInstance,
  options: CallRouteOptions = {},
): void {
  app.post('/voice/calls/start', withSecurityEventsFastify({ action: 'voice-call.create', resource: 'voice-call', severity: 'info' }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }
    // Tenant id ALWAYS from the verified JWT — never from the body.
    const sessionTenantId = requireUser(request).tenantId;
    if (parsed.data.tenantId && parsed.data.tenantId !== sessionTenantId) {
      void recordSecurityEvent({
        action: 'voice-call.create.tenant_mismatch',
        resource: 'voice-call',
        severity: 'warn',
        method: request.method,
        route: request.url,
        tenantId: sessionTenantId,
        actorId: requireUser(request).userId,
        detail: {
          sessionTenantId,
          bodyTenantId: parsed.data.tenantId,
          note: 'body tenantId ignored — session value used',
        },
      });
    }
    const wsBaseUrl =
      options.wsBaseUrl ??
      // Fall back to the request's protocol + host. WSS upgrades from HTTPS.
      `${request.protocol === 'https' ? 'wss' : 'ws'}://${request.hostname}`;

    const plan = planCall(parsed.data, { wsBaseUrl });
    reply.code(201);
    // Stamp the session-derived tenant id back in the response so
    // callers can confirm the tenant the brain will run under.
    return { ...plan, tenantId: sessionTenantId };
  }));
}
