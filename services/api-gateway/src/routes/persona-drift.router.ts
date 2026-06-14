/**
 * Persona-drift events read surface — KI-011 closure.
 *
 * The admin dashboard (`apps/admin-web/src/app/persona-drift/PersonaDriftClient.tsx`)
 * polls `GET /api/v1/persona-drift/events` every 60 s and renders the
 * persisted `kernel_persona_drift_events` breaches for the tenant. Until
 * now the gateway never mounted this route, so the client's fetch 404'd
 * and the screen showed a permanent "Could not load persona-drift events"
 * alert. This router mounts that endpoint.
 *
 * Auth model (mirrors `cot-query.router.ts`):
 *
 *   - JWT required (authMiddleware). Missing → 401.
 *   - SUPER_ADMIN / ADMIN / TENANT_ADMIN allowed. Anyone else → 403.
 *   - TENANT_ADMIN is locked to their JWT tenant. SUPER_ADMIN / ADMIN
 *     (platform admins) may pass `?tenantId=` to inspect any tenant for
 *     drift review; absent that, they default to their own JWT tenant.
 *
 * RLS:
 *
 *   `kernel_persona_drift_events` is FORCE ROW LEVEL SECURITY with a
 *   tenant-isolation policy keyed on `app.current_tenant_id`
 *   (migration 0305). The adapter wired in `index.ts` runs the read
 *   inside `withTenantContext(db, tenantId)` so the GUC is bound and the
 *   policy returns exactly that tenant's rows. This is a tenant-scoped
 *   read, NOT a cross-tenant scan — no service-role bypass is needed.
 *
 * Response shape — `{ data: DriftEvent[] }`, exactly what the client's
 * `data.data ?? []` unwrap expects.
 *
 * Storage abstraction:
 *
 *   The router talks to a duck-typed `PersonaDriftEventSource` pulled off
 *   `c.get('services')`. The composition root in `index.ts` wires the
 *   Drizzle-backed implementation. When the adapter is absent (no DB in
 *   this deployment) the route returns `{ data: [] }` — an HONEST empty
 *   state, so the client renders "Awaiting first breach" rather than the
 *   error alert. (Contrast with `cot-query`'s 503: that surface is a
 *   compliance read where silence would be misleading; here an empty
 *   list is the truthful answer for a tenant with no wired probe.)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

// ─────────────────────────────────────────────────────────────────────
// Adapter contract — the router talks to a row source via this
// duck-typed interface. The composition root in `index.ts` is the only
// place wiring the real Drizzle-backed (RLS-bound) implementation.
// ─────────────────────────────────────────────────────────────────────

export interface PersonaDriftEventRow {
  readonly id: string;
  readonly personaId: string;
  readonly violationType: string;
  readonly excerpt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detectedAt: string;
  /** Worst-dim hint, parsed from the excerpt when present. */
  readonly worstDim?: string;
}

export interface PersonaDriftEventSourceArgs {
  readonly tenantId: string;
  readonly limit: number;
}

export interface PersonaDriftEventSource {
  list(args: PersonaDriftEventSourceArgs): Promise<ReadonlyArray<PersonaDriftEventRow>>;
}

// ─────────────────────────────────────────────────────────────────────
// Role gates (mirror cot-query.router.ts).
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

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function isAdminRole(role: UserRole | undefined): boolean {
  return role !== undefined && ADMIN_ROLES.has(role);
}

function isPlatformAdminRole(role: UserRole | undefined): boolean {
  return role !== undefined && PLATFORM_ADMIN_ROLES.has(role);
}

function forbidden(c: any, message: string) {
  return c.json({ success: false, error: { code: 'FORBIDDEN', message } }, 403);
}

function badRequest(c: any, message: string) {
  return c.json({ success: false, error: { code: 'VALIDATION', message } }, 400);
}

function parseLimit(raw: string | undefined): { limit: number; error?: string } {
  if (raw === undefined || raw === '') return { limit: DEFAULT_LIMIT };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { limit: DEFAULT_LIMIT, error: 'limit must be a positive integer' };
  }
  return { limit: Math.min(Math.floor(n), MAX_LIMIT) };
}

function resolveSource(c: any): PersonaDriftEventSource | null {
  const services = (c.get('services') ?? {}) as {
    personaDriftEventSource?: PersonaDriftEventSource;
  };
  return services.personaDriftEventSource ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Router.
// ─────────────────────────────────────────────────────────────────────

export function createPersonaDriftRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/events', async (c: any) => {
    const auth = c.get('auth') ?? {};
    const role = auth.role as UserRole | undefined;

    if (!isAdminRole(role)) {
      return forbidden(c, 'Only admin roles may read persona-drift events');
    }

    // Resolve tenant scoping: TENANT_ADMIN is locked to their JWT tenant;
    // platform admins may inspect any tenant via ?tenantId=.
    const queryTenantId =
      c.req.query('tenantId') ?? c.req.query('tenant_id') ?? null;
    let effectiveTenantId: string | null;
    if (isPlatformAdminRole(role)) {
      effectiveTenantId = queryTenantId ?? auth.tenantId ?? null;
    } else {
      if (queryTenantId && queryTenantId !== auth.tenantId) {
        return forbidden(c, 'TENANT_ADMIN may only read their own tenant');
      }
      effectiveTenantId = auth.tenantId ?? null;
    }

    if (!effectiveTenantId) {
      return badRequest(
        c,
        'tenantId is required (no tenant on JWT and no query param)',
      );
    }

    const lim = parseLimit(c.req.query('limit'));
    if (lim.error) return badRequest(c, lim.error);

    const source = resolveSource(c);
    if (!source) {
      // No DB-backed adapter wired in this deployment. The truthful answer
      // for a tenant is "no breaches recorded" → empty list. The client
      // renders the friendly "Awaiting first breach" empty state, never the
      // error alert. (KI-011: this is the fix — a 404 here was the bug.)
      return c.json({ data: [] });
    }

    try {
      const rows = await source.list({
        tenantId: effectiveTenantId,
        limit: lim.limit,
      });
      return c.json({ data: rows });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'PERSONA_DRIFT_QUERY_FAILED',
        status: 500,
        fallback: 'Failed to read persona-drift events',
      });
    }
  });

  return app;
}

export default createPersonaDriftRouter;
