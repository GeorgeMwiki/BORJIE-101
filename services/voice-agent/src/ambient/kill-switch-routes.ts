/**
 * Kill-switch routes — HTTP surface for triggering the user-scope or
 * org-scope kill switch.
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decision 4 — admin can pause the org's ambient listening. The
 * implementation enforces that `scope='user'` requires
 * `target_user_id`. Tenant id always derived from the verified JWT.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { KILL_SWITCH_SCOPES } from '@borjie/ambient-listener';

import { requireUser } from '../middleware/auth.js';
import { logger } from '../logger.js';
import type { AmbientWiring } from './pipeline-wire.js';

const scopeSchema = z.enum(KILL_SWITCH_SCOPES);

const TriggerBodySchema = z
  .object({
    reason: z.string().min(1).max(500),
    scope: scopeSchema,
    target_user_id: z.string().uuid().optional(),
  })
  .refine(
    (data) => data.scope !== 'user' || typeof data.target_user_id === 'string',
    {
      message: 'target_user_id is required when scope=user',
      path: ['target_user_id'],
    },
  );

export interface KillSwitchRoutesDeps {
  readonly wiring: AmbientWiring;
}

export function registerKillSwitchRoutes(
  app: FastifyInstance,
  deps: KillSwitchRoutesDeps,
): void {
  app.post(
    '/voice/ambient/kill-switch/trigger',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = TriggerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          details: parsed.error.flatten(),
        };
      }
      const user = requireUser(request);
      const triggerArgs = {
        tenant_id: user.tenantId,
        triggered_by: user.userId,
        reason: parsed.data.reason,
        scope: parsed.data.scope,
        ...(parsed.data.target_user_id !== undefined
          ? { target_user_id: parsed.data.target_user_id }
          : {}),
      };
      const event = await deps.wiring.killSwitch.trigger(triggerArgs);
      logger.warn('ambient.kill_switch.trigger', {
        tenant_id: user.tenantId,
        scope: parsed.data.scope,
        triggered_by: user.userId,
        ...(parsed.data.target_user_id
          ? { target_user_id: parsed.data.target_user_id }
          : {}),
      });
      reply.code(201);
      return { event };
    },
  );

  app.get(
    '/voice/ambient/kill-switch/active',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const user = requireUser(request);
      const status = await deps.wiring.killSwitch.isActive(
        user.tenantId,
        user.userId,
      );
      return { status };
    },
  );
}
