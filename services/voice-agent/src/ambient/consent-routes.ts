/**
 * Consent routes — HTTP surface for granting / revoking / checking
 * ambient-listening consent on the chat / voice_call / sms channels.
 *
 * Every route is JWT-gated (the parent service's `authMiddleware` runs
 * before the per-route handler). Tenant id is read from the verified
 * JWT, never from the body — same pattern as `routes/call.ts`.
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decision 4 — 90-day re-consent + 24h opt-out.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  AMBIENT_CHANNELS,
  type AmbientChannel,
} from '@borjie/ambient-listener';

import { requireUser } from '../middleware/auth.js';
import { logger } from '../logger.js';
import type { AmbientWiring } from './pipeline-wire.js';

const channelSchema = z.enum(AMBIENT_CHANNELS);

const GrantBodySchema = z.object({
  channel: channelSchema,
  sentiment_consent: z.boolean().optional(),
});

const RevokeBodySchema = z.object({
  channel: channelSchema,
});

const CheckQuerySchema = z.object({
  channel: channelSchema,
});

export interface ConsentRoutesDeps {
  readonly wiring: AmbientWiring;
}

export function registerConsentRoutes(
  app: FastifyInstance,
  deps: ConsentRoutesDeps,
): void {
  app.post(
    '/voice/ambient/consent/grant',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = GrantBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          details: parsed.error.flatten(),
        };
      }
      const user = requireUser(request);
      const channel: AmbientChannel = parsed.data.channel;
      const grantArgs = {
        tenant_id: user.tenantId,
        user_id: user.userId,
        channel,
        granted_by: user.userId,
        ...(parsed.data.sentiment_consent !== undefined
          ? { sentiment_consent: parsed.data.sentiment_consent }
          : {}),
      };
      const consent = await deps.wiring.consentManager.grant(grantArgs);
      logger.info('ambient.consent.grant', {
        tenant_id: user.tenantId,
        user_id: user.userId,
        channel,
      });
      reply.code(201);
      return { consent };
    },
  );

  app.post(
    '/voice/ambient/consent/revoke',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RevokeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          details: parsed.error.flatten(),
        };
      }
      const user = requireUser(request);
      const consent = await deps.wiring.consentManager.revoke({
        tenant_id: user.tenantId,
        user_id: user.userId,
        channel: parsed.data.channel,
        revoked_by: user.userId,
      });
      logger.info('ambient.consent.revoke', {
        tenant_id: user.tenantId,
        user_id: user.userId,
        channel: parsed.data.channel,
      });
      return { consent };
    },
  );

  app.get(
    '/voice/ambient/consent/check',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CheckQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          details: parsed.error.flatten(),
        };
      }
      const user = requireUser(request);
      const result = await deps.wiring.consentManager.check({
        tenant_id: user.tenantId,
        user_id: user.userId,
        channel: parsed.data.channel,
      });
      return { result };
    },
  );
}
