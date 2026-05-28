/**
 * Prompt rollout router — admin-gated.
 *
 *   GET  /:capability/versions  → list all versions for a capability
 *   POST /:capability/shadow    → register a new shadow variant
 *   POST /:capability/promote   → promote shadow → canary → canary-25 → active
 *   POST /:capability/rollback  → instant rollback to previous active
 *
 * Central Command Phase D (D5 — Rollout safety). The factory takes a
 * `KernelPromptRegistryServiceLike` port — wire the real Drizzle service
 * in the composition root or pass an in-memory stub in tests.
 *
 * Sierra Agent Studio 2.0 ships a one-call "agent rollback support-bot
 * --to v42" semantic. The POST /rollback endpoint here is the same
 * shape — operator can recover from a bad ship in a single API call.
 */


import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import pino from 'pino';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';

import { withSecurityEvents } from '@borjie/observability';

const logger = pino({ name: 'prompt-rollout' });
// ─────────────────────────────────────────────────────────────────────
// Port shape — duck-typed against `KernelPromptRegistryService` so the
// router does not compile-time-depend on @borjie/database.
// ─────────────────────────────────────────────────────────────────────

export interface PromptVersionRowLike {
  readonly id: string;
  readonly capability: string;
  readonly version: string;
  readonly promptText: string;
  readonly goldenSetVersion: string;
  readonly status: string;
  readonly promotedAt: string;
  readonly promotedBy: string;
  readonly archivedAt: string | null;
  readonly archivedReason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface KernelPromptRegistryServiceLike {
  listForCapability(capability: string): Promise<ReadonlyArray<PromptVersionRowLike>>;
  registerShadow(args: {
    readonly capability: string;
    readonly version: string;
    readonly promptText: string;
    readonly goldenSetVersion: string;
    readonly promotedBy: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<PromptVersionRowLike>;
  promote(args: {
    readonly capability: string;
    readonly version: string;
    readonly toStatus: 'canary' | 'canary-25' | 'active';
    readonly promotedBy: string;
  }): Promise<PromptVersionRowLike>;
  rollback(args: {
    readonly capability: string;
    readonly reason: string;
    readonly promotedBy: string;
  }): Promise<{
    readonly previousActive: PromptVersionRowLike | null;
    readonly restoredActive: PromptVersionRowLike | null;
  }>;
}

/**
 * Audit ledger sink for rollback events. Opaque-by-design so the
 * composition root can wire whatever audit chain it prefers (sovereign
 * action ledger, kernel-action-audit, etc.). Errors are swallowed.
 */
export interface RolloutLedgerSinkLike {
  recordRollback(entry: {
    readonly capability: string;
    readonly previousVersion: string | null;
    readonly restoredVersion: string | null;
    readonly reason: string;
    readonly actorUserId: string;
    readonly recordedAt: string;
  }): Promise<void> | void;
}

export interface PromptRolloutRouterDeps {
  readonly registry: KernelPromptRegistryServiceLike;
  readonly ledgerSink?: RolloutLedgerSinkLike;
  readonly clock?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

const capabilityParamSchema = z.object({
  capability: z.string().min(1).max(120),
});

const shadowBodySchema = z.object({
  version: z.string().min(1).max(80),
  promptText: z.string().min(1).max(64 * 1024),
  goldenSetVersion: z.string().min(1).max(120),
  metadata: z.record(z.unknown()).optional(),
});

const promoteBodySchema = z.object({
  version: z.string().min(1).max(80),
  toStatus: z.enum(['canary', 'canary-25', 'active']),
});

const rollbackBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN] as const;

export function createPromptRolloutRouter(
  deps: PromptRolloutRouterDeps,
): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(...ADMIN_ROLES));

  const clock = deps.clock ?? (() => new Date());

  app.get(
    '/:capability/versions',
    zValidator('param', capabilityParamSchema),
    async (c) => {
      const { capability } = c.req.valid('param');
      try {
        const rows = await deps.registry.listForCapability(capability);
        return c.json({ success: true, data: { capability, versions: rows } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return c.json(
          {
            success: false,
            error: { code: 'REGISTRY_READ_FAILED', message },
          },
          500,
        );
      }
    },
  );

  app.post(
    '/:capability/shadow',
    zValidator('param', capabilityParamSchema),
    zValidator('json', shadowBodySchema),
    withSecurityEvents({ action: 'prompt-rollout.create', resource: 'prompt-rollout', severity: 'info' }, async (c) => {
      const { capability } = c.req.valid('param');
      const body = c.req.valid('json');
      const auth = c.get('auth');
      try {
        const row = await deps.registry.registerShadow({
          capability,
          version: body.version,
          promptText: body.promptText,
          goldenSetVersion: body.goldenSetVersion,
          promotedBy: auth?.userId ?? 'unknown-admin',
          metadata: body.metadata,
        });
        return c.json({ success: true, data: row }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return c.json(
          {
            success: false,
            error: { code: 'SHADOW_REGISTRATION_FAILED', message },
          },
          400,
        );
      }
    }),
  );

  app.post(
    '/:capability/promote',
    zValidator('param', capabilityParamSchema),
    zValidator('json', promoteBodySchema),
    withSecurityEvents({ action: 'prompt-rollout.create', resource: 'prompt-rollout', severity: 'info' }, async (c) => {
      const { capability } = c.req.valid('param');
      const body = c.req.valid('json');
      const auth = c.get('auth');
      try {
        const row = await deps.registry.promote({
          capability,
          version: body.version,
          toStatus: body.toStatus,
          promotedBy: auth?.userId ?? 'unknown-admin',
        });
        return c.json({ success: true, data: row });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return c.json(
          {
            success: false,
            error: { code: 'PROMOTION_FAILED', message },
          },
          400,
        );
      }
    }),
  );

  app.post(
    '/:capability/rollback',
    zValidator('param', capabilityParamSchema),
    zValidator('json', rollbackBodySchema),
    withSecurityEvents({ action: 'prompt-rollout.create', resource: 'prompt-rollout', severity: 'info' }, async (c) => {
      const { capability } = c.req.valid('param');
      const body = c.req.valid('json');
      const auth = c.get('auth');
      try {
        const result = await deps.registry.rollback({
          capability,
          reason: body.reason,
          promotedBy: auth?.userId ?? 'unknown-admin',
        });

        // Best-effort ledger sink. Audit channel — never break the
        // rollback API response if the sink throws.
        if (deps.ledgerSink) {
          try {
            await Promise.resolve(
              deps.ledgerSink.recordRollback({
                capability,
                previousVersion: result.previousActive?.version ?? null,
                restoredVersion: result.restoredActive?.version ?? null,
                reason: body.reason,
                actorUserId: auth?.userId ?? 'unknown-admin',
                recordedAt: clock().toISOString(),
              }),
            );
          } catch (sinkError) {
            logger.error({ err: sinkError }, 'prompt-rollout: ledger sink failed');
          }
        }

        return c.json({ success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return c.json(
          {
            success: false,
            error: { code: 'ROLLBACK_FAILED', message },
          },
          500,
        );
      }
    }),
  );

  return app;
}

export default createPromptRolloutRouter;
