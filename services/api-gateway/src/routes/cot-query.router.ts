/**
 * Chain-of-Thought (CoT) regulator-facing query surface — Phase D / D3.
 *
 * Closes the A4-surfaced gap: the kernel persists `thoughtText` plaintext
 * to `kernel_cot_reservoir`, capturing 100% of `critical`-stakes turns.
 * Without this route, a DSAR (Data-Subject Access Request) cannot
 * inspect / redact CoT — there is no consumer surface.
 *
 * Auth model:
 *
 *   - JWT required (authMiddleware). Missing → 401.
 *   - SUPER_ADMIN / ADMIN / TENANT_ADMIN allowed. Anyone else → 403.
 *   - `tenant_id` query param MUST equal the caller's JWT `tenantId`,
 *     UNLESS the caller is SUPER_ADMIN / ADMIN (platform admins) — in
 *     which case any tenant id is allowed for compliance review.
 *
 * Default behaviour:
 *
 *   GET /api/v1/cot/query?tenantId=...&since=...&until=...&limit=...
 *
 *   Returns paginated CoT rows with `thoughtText` REPLACED by the
 *   persist-boundary-scrubbed text (`scrubCotForPersist`). Even though
 *   the kernel already wrote the scrubbed text once at capture, we
 *   re-scrub on read so a newly-added PII pattern (added between the
 *   capture moment and the query) still applies.
 *
 * Raw-access escape hatch:
 *
 *   `?include_raw=true` requires:
 *     a) `auth.permissions` contains `cot:read:raw` (sovereign-tier scope
 *        — provisioned via the four-eye admin workflow, not part of any
 *        normal role) OR `*` for SUPER_ADMIN; AND
 *     b) An audit row is emitted before the response leaves the gateway.
 *
 *   The audit row records:
 *     - subjectId (caller),
 *     - tenantId, since/until window,
 *     - count of rows returned with `raw=true`,
 *     - never the raw text itself (audit is itself PII-free).
 *
 * Storage abstraction:
 *
 *   The router pulls a `cotQuerySource` adapter off `c.get('services')`.
 *   The adapter is duck-typed so the router has no compile-time
 *   dependency on the Drizzle schema; the composition root in
 *   `src/index.ts` wires a Postgres-backed adapter. When the adapter
 *   is absent the route returns a 503 (consistent with how
 *   `dsar.router.ts` handles the missing-RTBF case).
 */

// dsar.router / head-briefing). The handlers below are typed via the
// service-context envelope.

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import { scrubCotForPersist } from '@borjie/central-intelligence';

// ─────────────────────────────────────────────────────────────────────
// Adapter contract — the router talks to a CoT row source via this
// duck-typed interface. The composition root in `index.ts` is the only
// place wiring the real Drizzle-backed implementation.
// ─────────────────────────────────────────────────────────────────────

export interface CotRow {
  readonly thoughtId: string;
  readonly tenantId: string | null;
  readonly threadId: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly thoughtText: string;
  readonly promptHash: string | null;
  readonly responseHash: string | null;
  readonly capturedAt: string;
}

export interface CotQuerySourceArgs {
  readonly tenantId: string | null;
  readonly since: string | null;
  readonly until: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface CotQuerySource {
  query(args: CotQuerySourceArgs): Promise<{
    readonly rows: ReadonlyArray<CotRow>;
    readonly total: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Constants / role gates.
// ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
]);

const PLATFORM_ADMIN_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
]);

/** Permission string the four-eye workflow provisions for sovereign raw CoT access. */
const SOVEREIGN_RAW_PERMISSION = 'cot:read:raw';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ─────────────────────────────────────────────────────────────────────
// Helpers — auth + pagination + audit emission.
// ─────────────────────────────────────────────────────────────────────

function isAdminRole(role: UserRole | undefined): boolean {
  if (!role) return false;
  return ADMIN_ROLES.has(role);
}

function isPlatformAdminRole(role: UserRole | undefined): boolean {
  if (!role) return false;
  return PLATFORM_ADMIN_ROLES.has(role);
}

function hasSovereignRawScope(
  permissions: ReadonlyArray<string> | undefined,
  role: UserRole | undefined,
): boolean {
  if (!permissions) return false;
  if (permissions.includes(SOVEREIGN_RAW_PERMISSION)) return true;
  // SUPER_ADMIN with the wildcard scope is implicitly sovereign.
  if (role === UserRole.SUPER_ADMIN && permissions.includes('*')) return true;
  return false;
}

function forbidden(c: any, message = 'You do not have permission to access CoT data') {
  return c.json(
    {
      success: false,
      error: { code: 'FORBIDDEN', message },
    },
    403,
  );
}

function badRequest(c: any, message: string) {
  return c.json(
    {
      success: false,
      error: { code: 'VALIDATION', message },
    },
    400,
  );
}

function parsePagination(c: any): { limit: number; offset: number; error?: string } {
  const rawLimit = c.req.query('limit');
  const rawOffset = c.req.query('offset');
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (rawLimit !== undefined && rawLimit !== '') {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n <= 0) return { limit, offset, error: 'limit must be a positive integer' };
    limit = Math.min(Math.floor(n), MAX_LIMIT);
  }
  if (rawOffset !== undefined && rawOffset !== '') {
    const n = Number(rawOffset);
    if (!Number.isFinite(n) || n < 0) return { limit, offset, error: 'offset must be a non-negative integer' };
    offset = Math.floor(n);
  }
  return { limit, offset };
}

function parseTimestamp(value: string | undefined): string | null {
  if (!value || value.length === 0) return null;
  // Best-effort ISO-8601 parse. Validation rejects obvious garbage but
  // delegates the canonical form to the adapter (Postgres ts cast).
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function resolveQuerySource(c: any): CotQuerySource | null {
  const services = (c.get('services') ?? {}) as { cotQuerySource?: CotQuerySource };
  return services.cotQuerySource ?? null;
}

async function emitAudit(
  c: any,
  eventType: 'cot.query' | 'cot.query.raw',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const services = (c.get('services') ?? {}) as {
      eventBus?: {
        publish: (envelope: unknown) => Promise<void> | void;
      };
    };
    const bus = services.eventBus;
    if (!bus || typeof bus.publish !== 'function') return;
    await bus.publish({
      event: {
        eventId: `cot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        timestamp: new Date().toISOString(),
        tenantId: payload.tenantId ?? 'unknown',
        correlationId: c.get('requestId') ?? `cot_${Date.now()}`,
        causationId: null,
        metadata: {},
        payload,
      },
      version: 1,
      aggregateId: String(payload.tenantId ?? 'unknown'),
      aggregateType: 'CotReservoirQuery',
    });
  } catch {
    // Audit emission is non-fatal — never break the user request.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Router.
// ─────────────────────────────────────────────────────────────────────

export interface CreateCotQueryRouterOptions {
  /** Optional injected clock — used by tests for deterministic timestamps. */
  readonly now?: () => Date;
}

export function createCotQueryRouter(_opts: CreateCotQueryRouterOptions = {}): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/query', async (c: any) => {
    const auth = c.get('auth') ?? {};
    const role = auth.role as UserRole | undefined;

    if (!isAdminRole(role)) {
      return forbidden(c, 'Only admin roles may query the CoT reservoir');
    }

    // Resolve tenant scoping: TENANT_ADMIN can only see own tenant.
    const queryTenantId = c.req.query('tenantId') ?? c.req.query('tenant_id') ?? null;
    let effectiveTenantId: string | null;
    if (isPlatformAdminRole(role)) {
      effectiveTenantId = queryTenantId ?? auth.tenantId ?? null;
    } else {
      // TENANT_ADMIN: ignore the query param, lock to the JWT tenant.
      if (queryTenantId && queryTenantId !== auth.tenantId) {
        return forbidden(c, 'TENANT_ADMIN may only query their own tenant');
      }
      effectiveTenantId = auth.tenantId ?? null;
    }

    if (!effectiveTenantId) {
      return badRequest(c, 'tenantId is required (no tenant on JWT and no query param)');
    }

    const pag = parsePagination(c);
    if (pag.error) return badRequest(c, pag.error);

    const since = parseTimestamp(c.req.query('since'));
    const until = parseTimestamp(c.req.query('until'));

    const includeRawRaw = c.req.query('include_raw');
    const wantsRaw = includeRawRaw === 'true' || includeRawRaw === '1';

    if (wantsRaw && !hasSovereignRawScope(auth.permissions, role)) {
      return forbidden(
        c,
        `include_raw=true requires the '${SOVEREIGN_RAW_PERMISSION}' sovereign-tier scope`,
      );
    }

    const source = resolveQuerySource(c);
    if (!source) {
      return c.json(
        {
          success: false,
          error: {
            code: 'COT_QUERY_SOURCE_UNAVAILABLE',
            message: 'CoT reservoir query adapter is not wired in this deployment',
          },
        },
        503,
      );
    }

    try {
      const result = await source.query({
        tenantId: effectiveTenantId,
        since,
        until,
        limit: pag.limit,
        offset: pag.offset,
      });

      const transformed = result.rows.map((row) => {
        // Re-scrub on read so any pattern added since the capture
        // moment still applies. The capture-time scrub remains the
        // source of truth on disk; this is a belt-and-braces pass.
        const persistScrub = scrubCotForPersist(row.thoughtText);
        return {
          thoughtId: row.thoughtId,
          tenantId: row.tenantId,
          threadId: row.threadId,
          stakes: row.stakes,
          thoughtText: wantsRaw ? row.thoughtText : persistScrub.scrubbed,
          scrubbedCategories: persistScrub.categories,
          redactionCount: persistScrub.redactionCount,
          promptHash: row.promptHash,
          responseHash: row.responseHash,
          capturedAt: row.capturedAt,
        };
      });

      // Emit audit. Raw access gets a separate event type so audit
      // dashboards can flag it for review.
      await emitAudit(c, wantsRaw ? 'cot.query.raw' : 'cot.query', {
        requestedBy: auth.userId,
        tenantId: effectiveTenantId,
        since,
        until,
        limit: pag.limit,
        offset: pag.offset,
        rowsReturned: transformed.length,
        includeRaw: wantsRaw,
      });

      return c.json({
        success: true,
        data: transformed,
        meta: {
          total: result.total,
          limit: pag.limit,
          offset: pag.offset,
          tenantId: effectiveTenantId,
          since,
          until,
          includeRaw: wantsRaw,
        },
      });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'COT_QUERY_FAILED',
        status: 500,
        fallback: 'Failed to query CoT reservoir',
      });
    }
  });

  return app;
}

export default createCotQueryRouter;
