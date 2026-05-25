// @ts-nocheck — BehaviorObserver is imported from an ai-copilot subpath.
/**
 * Ambient-brain middleware.
 *
 * On every authenticated request we emit a lightweight behaviour event
 * through the shared `BehaviorObserver`. The observer detects stalls,
 * errors, and milestones and fires structured `ProactiveIntervention`
 * events. Subscribers in the SSE layer (future wave) push those to the
 * frontend; for now they are logged.
 *
 * Zero PII leaves the process: only `(tenantId, userId, route, method)`
 * is recorded.
 */

import { createMiddleware } from 'hono/factory';
import type { BehaviorObserver } from '@borjie/ai-copilot/ambient-brain';
import type { Logger } from 'pino';

export function createAmbientBrainMiddleware(
  observer: BehaviorObserver,
  logger?: Logger,
) {
  // Log interventions once at subscription time — each call emits them
  // to stdout so operators can see the ambient brain working during
  // development. SSE wiring is a later wave.
  observer.subscribe((intervention) => {
    if (logger) {
      logger.info(
        {
          intervention: {
            id: intervention.id,
            tenantId: intervention.tenantId,
            userId: intervention.userId,
            type: intervention.type,
            trigger: intervention.trigger,
            priority: intervention.priority,
          },
        },
        'ambient-brain intervention',
      );
    }
  });

  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string }
      | undefined;
    if (auth?.tenantId && auth?.userId) {
      try {
        observer.record({
          type: 'field_focus',
          timestamp: new Date().toISOString(),
          tenantId: auth.tenantId,
          userId: auth.userId,
          sectionId: `${c.req.method} ${c.req.path}`,
        });
      } catch {
        // never let observer errors crash a request
      }
    }
    await next();
  });
}
