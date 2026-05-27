/**
 * Pilot-error dashboard endpoint.
 *
 *   GET /api/v1/pilot/errors?since=ISO&cohort=string&limit=N
 *
 * Returns the most-recent N pilot errors grouped by cohort. Powers the
 * QA "did anything break in the last hour for the ferengi-alpha cohort?"
 * loop without requiring an external observability stack.
 *
 * Data source
 * ───────────
 * The handler reads from the in-memory ring buffer maintained by
 * `services/api-gateway/src/observability/pilot-mode.ts`. That sink is
 * populated by every `captureErrorWithPilotContext()` call across the
 * gateway — so any error reported via the pilot wrapper shows up here.
 *
 * A future Sentry-GraphQL reader is planned (the `loadFromSentry` hook
 * returns a typed "not yet wired" error so callers can detect the
 * unimplemented path without grep-ing for TODO/FIXME).
 *
 * Auth
 * ────
 * Admin-tier only. SUPER_ADMIN, ADMIN, or TENANT_ADMIN may read; any
 * other role gets a 403. Anonymous callers get a 401. The role gate
 * matches the pattern used by `admin-audit.router.ts`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { e401, e403, e500 } from '../utils/error-response';
import {
  queryPilotErrors,
  type PilotErrorRecord,
  type QueryPilotErrorsResult,
} from '../observability/pilot-mode';

// ─────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────

const PilotErrorsQuerySchema = z
  .object({
    since: z.string().min(1).max(40).optional(),
    cohort: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .partial()
  .strict();

const PILOT_ERROR_READ_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
]);

// ─────────────────────────────────────────────────────────────────────────
// Sentry GraphQL reader hook
// ─────────────────────────────────────────────────────────────────────────
//
// Future implementations will query Sentry's GraphQL API for events that
// match the pilot-mode tags. Until then, callers that explicitly request
// the Sentry source get a structured "not yet wired" error.

export class SentryReaderNotWiredError extends Error {
  constructor() {
    super(
      'Sentry pilot-error reader is not yet wired. Set source=memory or ' +
        'implement loadFromSentry() before requesting source=sentry.',
    );
    this.name = 'SentryReaderNotWiredError';
  }
}

export type PilotErrorSource = 'memory' | 'sentry';

export interface PilotErrorReader {
  query(opts: {
    since?: string;
    cohort?: string;
    limit?: number;
    source: PilotErrorSource;
  }): Promise<QueryPilotErrorsResult>;
}

const defaultReader: PilotErrorReader = {
  async query(opts) {
    if (opts.source === 'sentry') {
      throw new SentryReaderNotWiredError();
    }
    return queryPilotErrors(opts);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Router factory
// ─────────────────────────────────────────────────────────────────────────

export interface CreatePilotErrorsRouterOptions {
  /** Override the reader — primarily used by tests. */
  readonly reader?: PilotErrorReader;
}

interface PilotErrorsResponseBody {
  readonly success: true;
  readonly data: ReadonlyArray<PilotErrorRecord>;
  readonly meta: {
    readonly total: number;
    readonly limit: number;
    readonly byCohort: Readonly<Record<string, number>>;
    readonly source: PilotErrorSource;
    readonly timestamp: string;
  };
}

export function createPilotErrorsRouter(
  options: CreatePilotErrorsRouterOptions = {},
): Hono {
  const reader = options.reader ?? defaultReader;
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get(
    '/errors',
    zValidator('query', PilotErrorsQuerySchema.optional()),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      if (!auth.userId) {
        return e401(c, 'UNAUTHENTICATED', 'Pilot-error feed requires auth');
      }
      const role = auth.role as UserRole | undefined;
      if (!role || !PILOT_ERROR_READ_ROLES.has(role)) {
        return e403(
          c,
          'FORBIDDEN',
          'Pilot-error feed is restricted to admin tiers',
        );
      }

      const rawQuery = (c.req.valid('query') ?? {}) as {
        since?: string;
        cohort?: string;
        limit?: number;
      };

      try {
        const result = await reader.query({
          source: 'memory',
          ...(rawQuery.since && { since: rawQuery.since }),
          ...(rawQuery.cohort && { cohort: rawQuery.cohort }),
          ...(rawQuery.limit !== undefined && { limit: rawQuery.limit }),
        });
        const limit = rawQuery.limit ?? 100;
        const body: PilotErrorsResponseBody = {
          success: true,
          data: result.items,
          meta: {
            total: result.total,
            limit,
            byCohort: result.byCohort,
            source: 'memory',
            timestamp: new Date().toISOString(),
          },
        };
        return c.json(body, 200);
      } catch (err) {
        if (err instanceof SentryReaderNotWiredError) {
          return e500(c, 'SENTRY_READER_NOT_WIRED', err.message);
        }
        return e500(
          c,
          'PILOT_ERRORS_READ_FAILED',
          err instanceof Error
            ? err.message
            : 'Failed to read pilot-error feed',
        );
      }
    },
  );

  return app;
}
