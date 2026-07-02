/**
 * mcp-public /actions/approve — four-eye separation-of-duties route mapping.
 *
 * The four-eye store (services/mcp-server-borjie/src/four-eye.ts) throws
 * `SelfApprovalError` when the approver principal equals the action's
 * `initiatedBy`. This route must surface that as a clean 403
 * (`self_approval_forbidden`), NOT an unhandled 500.
 *
 * Drives the REAL `mcpPublicRouter`: seed a pending four-eye approval via
 * `POST /mcp` (a `sovereign.*` tools/call, which the dispatcher stamps with
 * `initiatedBy` = the resolved owner identity), then call `POST /actions/approve`
 * as that SAME owner -> 403; a distinct approver is accepted (200), proving the
 * guard is separation-of-duties, not a blanket rejection.
 *
 * JWT_SECRET is set BEFORE the router loads (hono-auth captures it as a const at
 * module load), and the router is dynamic-imported so that ordering holds. Only
 * the DB is a stub (databaseMiddlewareNoPin honours a pre-injected `db`).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import {
  makeApprovalRowStore,
  makeFakeApprovalDb,
} from '../../mcp/__tests__/fake-approval-db';

const JWT_SECRET = 'test-jwt-secret-four-eye-sod-0123456789abcdef';
// Must be set before hono-auth (transitively imported by the router) loads.
process.env['JWT_SECRET'] = JWT_SECRET;

const OWNER = 'owner-self-approver';
const TENANT = 'tenant-fe-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcpPublicRouter: any;

// A durable-store-shaped fake db (in-memory rows behind the drizzle
// surface) so the REAL Postgres ApprovalStore code path runs: the
// `POST /mcp` seed persists a pending row via insert().returning(), and
// `POST /actions/approve` reads/updates it. One shared `rows` map is
// injected per app so create -> approve share state across requests
// (the durable-table equivalent). The route's projected reads
// (resolveAuthContext -> clientLabel, killSwitchOpen -> level,
// resolveApprovalTenant -> tenantId) are answered by authRow/tenantRow.
function makeDb(rows: ReturnType<typeof makeApprovalRowStore>) {
  return makeFakeApprovalDb({
    rows,
    authRow: {
      id: 'tok-fe-1',
      tenantId: TENANT,
      userId: OWNER,
      scopes: ['owner:write', 'admin:read'],
      clientLabel: 'fe-agent',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      issuedAt: new Date(Date.now() - 1_000),
    },
    tenantRow: { tenantId: TENANT },
  });
}

function testApp(): Hono {
  const app = new Hono();
  const rows = makeApprovalRowStore();
  const db = makeDb(rows);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('repos', {});
    return next();
  });
  app.route('/', mcpPublicRouter);
  return app;
}

function ownerJwt(userId: string): string {
  // HS256 Borjie service token: carries userId/tenantId/role DIRECTLY
  // (coerceVerifiedJwtPayload reads those claims, not Supabase app_metadata).
  return jwt.sign({ userId, tenantId: TENANT, role: 'OWNER', sub: userId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

async function seedPendingApproval(app: Hono): Promise<string> {
  const res = await app.request('/', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer agent-opaque-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init',
      method: 'tools/call',
      params: { name: 'sovereign.audit', arguments: {} },
    }),
  });
  const body = (await res.json()) as {
    error?: { code: number; data?: { approvalId?: string } };
  };
  expect(body.error?.code).toBe(-32011); // four-eye pending approval
  const approvalId = body.error?.data?.approvalId;
  expect(typeof approvalId).toBe('string');
  return approvalId as string;
}

describe('mcp /actions/approve — four-eye self-approval maps to 403 (not 500)', () => {
  beforeAll(async () => {
    mcpPublicRouter = (await import('../mcp-public.hono')).default;
  });

  it('returns 403 self_approval_forbidden when the approver is the initiator', async () => {
    const app = testApp();
    const approvalId = await seedPendingApproval(app);
    const res = await app.request('/actions/approve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerJwt(OWNER)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approvalId }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('self_approval_forbidden');
  });

  it('allows a distinct approver (approver !== initiator)', async () => {
    const app = testApp();
    const approvalId = await seedPendingApproval(app);
    const res = await app.request('/actions/approve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerJwt('owner-different-eye')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approvalId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
