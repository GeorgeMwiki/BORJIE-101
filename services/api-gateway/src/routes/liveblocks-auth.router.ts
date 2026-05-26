/**
 * Liveblocks auth router — Central Command Phase B (B6).
 *
 * `POST /api/v1/realtime/auth` mints a Liveblocks session token using
 * `@liveblocks/node`'s `Liveblocks#prepareSession`. The token grants
 * the caller access to ONLY the rooms in their tenant scope.
 *
 * Tenant isolation is structural:
 *   1. The caller's `tenantId` is read from the JWT (NEVER from the body).
 *   2. Requested room ids MUST match the canonical pattern
 *      `borjie:<kind>:<tenantId>:<resourceId>` where `<tenantId>`
 *      is the caller's tenantId.
 *   3. Any room whose id doesn't match is REJECTED — even minting a
 *      token for a non-existent room of another tenant leaks no info
 *      because the matcher runs BEFORE Liveblocks is contacted.
 *
 * Degraded mode: when `LIVEBLOCKS_SECRET_KEY` is unset (no Liveblocks
 * env), the route returns `503 LIVEBLOCKS_UNAVAILABLE`. The client
 * libraries treat 503 as "real-time collab disabled" and fall back to
 * SSE-only state sync. This mirrors how `intelligence.router.ts`
 * degrades when its LLM url is missing.
 *
 * Body schema:
 *   {
 *     "rooms": [
 *       { "id": "borjie:lease-editing:tnt-1:lease-42",
 *         "access": "FULL" | "READ_ONLY" }
 *     ]
 *   }
 *
 * Response: the raw Liveblocks `{ token, ... }` envelope (the
 * client SDK consumes that shape natively).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
// Liveblocks node SDK is loaded lazily so the gateway boots without
// the package installed (degraded mode returns 503). The factory is
// injectable for tests — see {@link configureLiveblocksFactory}.

const RoomRequestSchema = z
  .object({
    id: z.string().min(1).max(256),
    access: z.enum(['FULL', 'READ_ONLY']).default('FULL'),
  })
  .strict();

const PostBodySchema = z
  .object({
    rooms: z.array(RoomRequestSchema).min(1).max(16),
  })
  .strict();

const CANONICAL_ROOM_ID = /^borjie:(lease-editing|maintenance-thread):([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/;

export interface LiveblocksTokenResult {
  readonly token: string;
}

export interface LiveblocksAdapter {
  prepareSession: (input: {
    userId: string;
    userInfo: Record<string, unknown>;
    rooms: ReadonlyArray<{ readonly id: string; readonly access: 'FULL' | 'READ_ONLY' }>;
  }) => Promise<LiveblocksTokenResult>;
}

type LiveblocksFactory = (secret: string) => LiveblocksAdapter;

let factory: LiveblocksFactory | null = null;

/**
 * Inject a Liveblocks adapter factory. Production wires
 * `(secret) => new Liveblocks({ secret }).prepareSession(...)`; tests
 * pass an in-memory stub.
 */
export function configureLiveblocksAdapter(f: LiveblocksFactory): void {
  factory = f;
}

/** Test-only — reset the configured factory. */
export function __resetLiveblocksAdapter(): void {
  factory = null;
}

function getSecretFromEnv(): string | null {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  return typeof secret === 'string' && secret.length > 0 ? secret : null;
}

function unavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'LIVEBLOCKS_UNAVAILABLE',
        message:
          'Real-time collaboration requires LIVEBLOCKS_SECRET_KEY to be set.',
      },
    },
    503,
  );
}

const app = new Hono();
app.use('*', authMiddleware);

app.post(
  '/auth',
  zValidator('json', PostBodySchema),
  withSecurityEvents({ action: 'liveblocks-auth.create', resource: 'liveblocks-auth', severity: 'warn' }, async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string; role?: string }
      | undefined;
    if (!auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'auth context missing' },
        },
        401,
      );
    }

    const body = c.req.valid('json') as z.infer<typeof PostBodySchema>;

    // Tenant-scope gate: every requested room must match the caller's
    // tenantId. We reject the WHOLE request on a single bad room so
    // the client can't probe which rooms belong to which tenants.
    const offending = body.rooms.find((r) => {
      const match = CANONICAL_ROOM_ID.exec(r.id);
      if (!match) return true;
      const tenantInRoom = match[2];
      return tenantInRoom !== auth.tenantId;
    });
    if (offending) {
      return c.json(
        {
          success: false,
          error: {
            code: 'LIVEBLOCKS_ROOM_FORBIDDEN',
            message:
              'One or more requested rooms are outside your tenant scope.',
          },
        },
        403,
      );
    }

    const secret = getSecretFromEnv();
    if (!secret) return unavailable(c);
    if (!factory) {
      // Production should call configureLiveblocksAdapter(...) at boot.
      // If it didn't, treat as degraded so we never silently mint
      // tokens with the wrong claims.
      return unavailable(c);
    }

    try {
      const adapter = factory(secret);
      const result = await adapter.prepareSession({
        userId: auth.userId,
        userInfo: {
          tenantId: auth.tenantId,
          role: auth.role ?? 'user',
        },
        rooms: body.rooms,
      });
      return c.json({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      return c.json(
        {
          success: false,
          error: {
            code: 'LIVEBLOCKS_SESSION_FAILED',
            message,
          },
        },
        500,
      );
    }
  }),
);

export const liveblocksAuthRouter = app;
export default app;
