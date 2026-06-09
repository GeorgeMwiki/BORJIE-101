/**
 * /api/v1/mining/statements — BFF proxy to the standalone payments-ledger
 * service's statement-generation surface (FIX 3).
 *
 * The real M-Pesa / Stripe statement generation lives in the standalone
 * `@borjie/payments-ledger-service` (Express app), which the api-gateway
 * never proxied and no surface consumed — so statements were unreachable
 * from any owner/buyer client. This router is the thin, authenticated,
 * tenant-scoped BFF that forwards a statements read to that service.
 *
 * Security posture:
 *   - `authMiddleware` runs first: the request must carry a valid Supabase
 *     JWT. The gateway forwards the SAME `Authorization: Bearer …` header to
 *     the downstream service, which runs its OWN `verifySupabaseAuthMiddleware`
 *     and derives the tenant principal from the verified token — the tenant
 *     scope is therefore enforced end-to-end by the downstream service, never
 *     trusted from a header the client controls.
 *   - We forward ONLY the Authorization header (+ the read query). No service
 *     internals, secrets, or service-role credentials are ever exposed to the
 *     client; the gateway holds no extra privilege here — it is a pass-through.
 *   - Read-only: GET only. Statement GENERATION (POST) is intentionally NOT
 *     proxied here.
 *
 * Wiring: this file is provided for the serial chokepoint wave to mount. It
 * is NOT mounted yet. See the lane return `deferredMounts` for the exact
 * mount line.
 *
 * Bilingual sw/en error copy on every 4xx/5xx the gateway itself emits.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-statements-proxy');

/**
 * Downstream payments-ledger base URL. Read once at module load from the
 * already-provisioned `PAYMENTS_LEDGER_URL` env (see k8s configmap). When
 * unset, the proxy returns a degraded 503 rather than guessing a host.
 */
const PAYMENTS_LEDGER_URL = process.env.PAYMENTS_LEDGER_URL?.trim() ?? '';

function bilingual(en: string, sw: string): { en: string; sw: string } {
  return { en, sw };
}

/** Validate the forwarded list query so we never relay arbitrary params. */
const ListQuerySchema = z.object({
  ownerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

/** Statement id path param — uuid only, no traversal. */
const StatementIdSchema = z.string().uuid();

export const miningStatementsRouter = new Hono();
miningStatementsRouter.use('*', authMiddleware);

/**
 * Forward a GET to the payments-ledger service, relaying the caller's
 * Authorization header. Returns the downstream JSON verbatim. Comprehensive
 * try/catch — a downstream outage degrades to a bilingual 502, never a leak.
 */
async function forwardGet(
  authHeader: string,
  path: string,
  search: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${PAYMENTS_LEDGER_URL}${path}${search ? `?${search}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// GET /  — list statements (tenant-scoped downstream)
// ---------------------------------------------------------------------------

miningStatementsRouter.get('/', async (c) => {
  if (!PAYMENTS_LEDGER_URL) {
    return c.json(
      {
        success: false,
        error: {
          code: 'STATEMENTS_UNAVAILABLE',
          message: bilingual(
            'Statements service is not configured',
            'Huduma ya taarifa haijawekwa',
          ),
        },
      },
      503,
    );
  }
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: bilingual(
            'Missing authorization',
            'Hakuna idhini',
          ),
        },
      },
      401,
    );
  }
  const parsed = ListQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: bilingual(
            'Invalid statements query',
            'Hoja ya taarifa si sahihi',
          ),
        },
      },
      400,
    );
  }
  // Re-serialise only the validated params (never pass through raw input).
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) search.set(k, String(v));
  }
  try {
    const { status, body } = await forwardGet(
      authHeader,
      '/api/v1/statements',
      search.toString(),
    );
    return c.json(body as Record<string, unknown>, status as 200);
  } catch (err) {
    moduleLogger.error({ err }, 'statements_list_proxy_failed');
    return c.json(
      {
        success: false,
        error: {
          code: 'STATEMENTS_UPSTREAM_ERROR',
          message: bilingual(
            'Could not reach the statements service',
            'Imeshindwa kufikia huduma ya taarifa',
          ),
        },
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /:id  — statement details (tenant-scoped downstream)
// ---------------------------------------------------------------------------

miningStatementsRouter.get('/:id', async (c) => {
  if (!PAYMENTS_LEDGER_URL) {
    return c.json(
      {
        success: false,
        error: {
          code: 'STATEMENTS_UNAVAILABLE',
          message: bilingual(
            'Statements service is not configured',
            'Huduma ya taarifa haijawekwa',
          ),
        },
      },
      503,
    );
  }
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: bilingual('Missing authorization', 'Hakuna idhini'),
        },
      },
      401,
    );
  }
  const idParsed = StatementIdSchema.safeParse(c.req.param('id'));
  if (!idParsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_STATEMENT_ID',
          message: bilingual(
            'Invalid statement id',
            'Kitambulisho cha taarifa si sahihi',
          ),
        },
      },
      400,
    );
  }
  try {
    const { status, body } = await forwardGet(
      authHeader,
      `/api/v1/statements/${encodeURIComponent(idParsed.data)}`,
      '',
    );
    return c.json(body as Record<string, unknown>, status as 200);
  } catch (err) {
    moduleLogger.error({ err }, 'statements_detail_proxy_failed');
    return c.json(
      {
        success: false,
        error: {
          code: 'STATEMENTS_UPSTREAM_ERROR',
          message: bilingual(
            'Could not reach the statements service',
            'Imeshindwa kufikia huduma ya taarifa',
          ),
        },
      },
      502,
    );
  }
});

export default miningStatementsRouter;
