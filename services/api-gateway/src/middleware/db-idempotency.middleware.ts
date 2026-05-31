/**
 * DB-backed Idempotency Middleware — hard server-side uniqueness.
 *
 * Closes H2 deferral. The legacy Redis-backed `idempotency.ts` and
 * `webhook-idempotency.middleware.ts` cached responses but could not
 * stop two simultaneous duplicate requests from both passing through
 * to the handler under a Redis split-brain or before the first replica
 * SETEXed. This middleware enforces the dedup invariant in the
 * database itself via the partial unique index on `idempotency_keys`.
 *
 * Flow:
 *   1. Read the Idempotency-Key header. If absent, fall through.
 *   2. Compute a stable request hash (method + path + body bytes).
 *   3. INSERT a row with `state = 'in_flight'`:
 *        a. If the INSERT succeeds → first delivery: run the handler,
 *           UPDATE the row with the captured response, fall through.
 *        b. If the INSERT collides on the unique index → read the
 *           existing row:
 *             - `state = 'completed'` → return the cached response.
 *             - `state = 'in_flight'` → return 409 with Retry-After.
 *             - request_hash mismatch → return 422 (request body
 *               must match for the key to be reused).
 *
 * On any DB failure the middleware FAILS LOUD with 503 so the caller
 * retries — silently bypassing would defeat the whole point.
 *
 * Tenant scoping:
 *   - When the caller has an authenticated JWT (`c.get('auth')`),
 *     `tenant_id` is bound to the JWT principal — never the
 *     `x-tenant-id` header.
 *   - When there is no auth (webhook surfaces), `tenant_id` is NULL
 *     and the unique scope is (key, resource_kind).
 */

import { createHash } from 'crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { createDatabaseClient, idempotencyKeys } from '@borjie/database';
import { createLogger } from '../utils/logger';

// Locally-derived alias to avoid TS2709 namespace drift on the
// barrel-exported `DatabaseClient`. Same pattern as middleware/database.ts.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const moduleLogger = createLogger('db-idempotency-mw');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REPLAY_MARKER_HEADER = 'idempotent-replay';
const HASH_MARKER_HEADER = 'idempotent-request-hash';
const MAX_KEY_LENGTH = 256;

// RFC-9457 / Idempotency-Key draft recommends URL-safe charset.
const keyShape = z
  .string()
  .min(1)
  .max(MAX_KEY_LENGTH)
  .regex(/^[A-Za-z0-9_\-.]+$/);

function safeParseKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = keyShape.safeParse(raw.trim());
  return parsed.success ? parsed.data : null;
}

/**
 * Stable hash of (method, path, raw body bytes). Clones request so
 * the handler still sees the unconsumed stream.
 */
async function hashRequest(c: Context): Promise<string> {
  const method = c.req.method.toUpperCase();
  const path = c.req.path;
  let bodyHex = '';
  if (MUTATION_METHODS.has(method)) {
    try {
      const cloned = c.req.raw.clone();
      const buf = await cloned.arrayBuffer();
      if (buf.byteLength > 0) {
        bodyHex = createHash('sha256').update(new Uint8Array(buf)).digest('hex');
      }
    } catch (err) {
      moduleLogger.warn('db-idempotency: failed to clone request for hashing', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return createHash('sha256')
    .update(`${method}|${path}|${bodyHex}`)
    .digest('hex');
}

export interface DbIdempotencyOptions {
  readonly resourceKind: string;
  readonly ttlMs?: number;
  readonly extractKey?: (c: Context) => string | null | Promise<string | null>;
  readonly extractTenantId?: (
    c: Context,
  ) => string | null | Promise<string | null>;
}

interface AuthShape {
  readonly tenantId?: string;
  readonly userId?: string;
}

function readAuth(c: Context): AuthShape | undefined {
  return c.get('auth') as AuthShape | undefined;
}

function readDb(c: Context): DatabaseClient | undefined {
  return c.get('db') as DatabaseClient | undefined;
}

const cachedHeadersSchema = z.record(z.string());
const cachedBodySchema = z.unknown();

const REPLAY_ALLOW_HEADERS = new Set([
  'content-type',
  'x-request-id',
  REPLAY_MARKER_HEADER,
]);

function snapshotHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (!REPLAY_ALLOW_HEADERS.has(name.toLowerCase())) return;
    out[name] = value;
  });
  return out;
}

export function createDbIdempotencyMiddleware(
  options: DbIdempotencyOptions,
): MiddlewareHandler {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const extractKey =
    options.extractKey ?? ((c: Context) => c.req.header('idempotency-key') ?? null);

  return async (c: Context, next): Promise<void | Response> => {
    if (!MUTATION_METHODS.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    let rawKey: string | null = null;
    try {
      const maybe = await extractKey(c);
      rawKey = typeof maybe === 'string' ? maybe : null;
    } catch (err) {
      moduleLogger.warn('db-idempotency: extractKey threw', {
        err: err instanceof Error ? err.message : String(err),
        resourceKind: options.resourceKind,
      });
      rawKey = null;
    }
    const key = safeParseKey(rawKey);
    if (!key) {
      await next();
      return;
    }

    const db = readDb(c);
    if (!db) {
      moduleLogger.error('db-idempotency: db missing on context — returning 503', {
        resourceKind: options.resourceKind,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'IDEMPOTENCY_DB_UNAVAILABLE',
            message:
              'Idempotency store is unavailable — retry against a healthy replica.',
          },
        },
        503,
      );
    }

    let tenantId: string | null = null;
    if (options.extractTenantId) {
      try {
        const t = await options.extractTenantId(c);
        tenantId = typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
      } catch (err) {
        moduleLogger.warn('db-idempotency: extractTenantId threw', {
          err: err instanceof Error ? err.message : String(err),
        });
        tenantId = null;
      }
    }
    if (!tenantId) {
      const auth = readAuth(c);
      const fromJwt = auth?.tenantId;
      tenantId = typeof fromJwt === 'string' && fromJwt.length > 0 ? fromJwt : null;
    }

    const requestHash = await hashRequest(c);
    const auth = readAuth(c);
    const actorId = auth?.userId ?? null;
    const expiresAt = new Date(Date.now() + ttlMs);

    let insertedNew = false;
    try {
      if (tenantId !== null) {
        const inserted = await db
          .insert(idempotencyKeys)
          .values({
            tenantId,
            key,
            resourceKind: options.resourceKind,
            requestHash,
            state: 'in_flight',
            actorId,
            expiresAt,
          })
          .onConflictDoNothing({
            target: [
              idempotencyKeys.tenantId,
              idempotencyKeys.key,
              idempotencyKeys.resourceKind,
            ],
            targetWhere: sql`tenant_id IS NOT NULL`,
          })
          .returning({ id: idempotencyKeys.id });
        insertedNew = inserted.length > 0;
      } else {
        const inserted = await db
          .insert(idempotencyKeys)
          .values({
            tenantId: null,
            key,
            resourceKind: options.resourceKind,
            requestHash,
            state: 'in_flight',
            actorId,
            expiresAt,
          })
          .onConflictDoNothing({
            target: [idempotencyKeys.key, idempotencyKeys.resourceKind],
            targetWhere: sql`tenant_id IS NULL`,
          })
          .returning({ id: idempotencyKeys.id });
        insertedNew = inserted.length > 0;
      }
    } catch (err) {
      moduleLogger.error('db-idempotency: INSERT failed — returning 503', {
        err: err instanceof Error ? err.message : String(err),
        resourceKind: options.resourceKind,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'IDEMPOTENCY_INSERT_FAILED',
            message: 'Could not register idempotency key — retry.',
          },
        },
        503,
      );
    }

    if (!insertedNew) {
      let existing: typeof idempotencyKeys.$inferSelect | undefined;
      try {
        const rows = tenantId !== null
          ? await db
              .select()
              .from(idempotencyKeys)
              .where(
                and(
                  eq(idempotencyKeys.tenantId, tenantId),
                  eq(idempotencyKeys.key, key),
                  eq(idempotencyKeys.resourceKind, options.resourceKind),
                ),
              )
              .limit(1)
          : await db
              .select()
              .from(idempotencyKeys)
              .where(
                and(
                  isNull(idempotencyKeys.tenantId),
                  eq(idempotencyKeys.key, key),
                  eq(idempotencyKeys.resourceKind, options.resourceKind),
                ),
              )
              .limit(1);
        existing = rows[0];
      } catch (err) {
        moduleLogger.error('db-idempotency: SELECT on collision failed — 503', {
          err: err instanceof Error ? err.message : String(err),
          resourceKind: options.resourceKind,
        });
        return c.json(
          {
            success: false,
            error: {
              code: 'IDEMPOTENCY_LOOKUP_FAILED',
              message: 'Could not look up cached response — retry.',
            },
          },
          503,
        );
      }

      if (!existing) {
        moduleLogger.warn('db-idempotency: collision row vanished — 409', {
          resourceKind: options.resourceKind,
        });
        return c.json(
          {
            success: false,
            error: {
              code: 'IDEMPOTENCY_RACE',
              message: 'Idempotency record disappeared mid-flight — retry.',
            },
          },
          409,
        );
      }

      if (existing.requestHash !== requestHash) {
        moduleLogger.warn('db-idempotency: request hash mismatch — 422', {
          resourceKind: options.resourceKind,
          stored: existing.requestHash,
          actual: requestHash,
        });
        return c.json(
          {
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message:
                'The same Idempotency-Key was reused with a different request body.',
            },
          },
          422,
        );
      }

      if (existing.state === 'in_flight') {
        c.header('Retry-After', '2');
        return c.json(
          {
            success: false,
            error: {
              code: 'IDEMPOTENCY_IN_FLIGHT',
              message:
                'A request with this Idempotency-Key is still in flight. Retry after Retry-After seconds.',
            },
          },
          409,
        );
      }

      const status =
        typeof existing.responseStatus === 'number' && existing.responseStatus >= 100
          ? existing.responseStatus
          : 200;

      const parsedHeaders = cachedHeadersSchema.safeParse(existing.responseHeaders ?? {});
      if (parsedHeaders.success) {
        for (const [h, v] of Object.entries(parsedHeaders.data)) {
          if (!REPLAY_ALLOW_HEADERS.has(h.toLowerCase())) continue;
          c.header(h, v);
        }
      }
      c.header(REPLAY_MARKER_HEADER, 'true');
      c.header(HASH_MARKER_HEADER, existing.requestHash);
      const bodyVerdict = cachedBodySchema.safeParse(existing.responseBody);
      const body = bodyVerdict.success ? bodyVerdict.data : null;
      return c.json(body, status as 200 | 201);
    }

    await next();

    const status = c.res.status;
    const willCache = status >= 200 && status < 300;

    if (willCache) {
      try {
        const cloned = c.res.clone();
        const text = await cloned.text();
        let parsedBody: unknown = null;
        if (text.length > 0) {
          try {
            parsedBody = JSON.parse(text);
          } catch {
            parsedBody = text;
          }
        }
        const headers = snapshotHeaders(cloned);
        await db
          .update(idempotencyKeys)
          .set({
            state: 'completed',
            responseStatus: status,
            responseBody: parsedBody as never,
            responseHeaders: headers as never,
            completedAt: new Date(),
          })
          .where(
            and(
              tenantId !== null
                ? eq(idempotencyKeys.tenantId, tenantId)
                : isNull(idempotencyKeys.tenantId),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.resourceKind, options.resourceKind),
            ),
          );
      } catch (err) {
        moduleLogger.error('db-idempotency: completion UPDATE failed', {
          err: err instanceof Error ? err.message : String(err),
          resourceKind: options.resourceKind,
        });
      }
    } else {
      try {
        await db
          .update(idempotencyKeys)
          .set({
            state: 'failed',
            responseStatus: status,
            completedAt: new Date(),
          })
          .where(
            and(
              tenantId !== null
                ? eq(idempotencyKeys.tenantId, tenantId)
                : isNull(idempotencyKeys.tenantId),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.resourceKind, options.resourceKind),
            ),
          );
      } catch (err) {
        moduleLogger.error('db-idempotency: failure UPDATE failed', {
          err: err instanceof Error ? err.message : String(err),
          resourceKind: options.resourceKind,
        });
      }
    }
  };
}

export const __internal = {
  hashRequest,
  safeParseKey,
  REPLAY_ALLOW_HEADERS,
  REPLAY_MARKER_HEADER,
  HASH_MARKER_HEADER,
  snapshotHeaders,
};
