/**
 * DSAR router tests (W-Data, wave-K).
 *
 * Verifies the HTTP surface of the DSAR endpoints:
 *   - admin can export any subject
 *   - subject can export own bundle (matching userId / email)
 *   - non-admin non-subject is 403
 *   - subject not found returns empty bundle (not 404)
 *   - classification annotations are present
 *   - audit emission fires
 *   - rate-limit triggers after 3 exports per tenant
 *   - RTBF stub returns accepted + scheduledAt (admin only)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createDsarRouter,
  _resetExportRateBucketForTests,
} from '../dsar.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import type {
  DsarDataSource,
  DsarTableName,
  DsarRow,
  DsarClassificationLookup,
  DsarRtbfExecutor,
  RtbfExecutionReport,
} from '@borjie/ai-copilot';

interface EventCapture {
  readonly type: string;
  readonly payload: unknown;
}

function captureBus(captured: EventCapture[]) {
  return {
    async publish(envelope: unknown) {
      const env = envelope as { event?: { eventType?: string; payload?: unknown } };
      captured.push({
        type: env.event?.eventType ?? 'unknown',
        payload: env.event?.payload ?? null,
      });
    },
  };
}

function fixedSubjectDataSource(
  rows: Record<string, ReadonlyArray<DsarRow>>,
): DsarDataSource {
  return {
    async listAffectedTables(): Promise<ReadonlyArray<DsarTableName>> {
      return Object.keys(rows) as ReadonlyArray<DsarTableName>;
    },
    async readPersonalDataForSubject({ table }) {
      return rows[table] ?? [];
    },
  };
}

function classificationLookup(): DsarClassificationLookup {
  return {
    classify(table: string, column: string) {
      if (table === 'customers' && column === 'email') {
        return { table, column, level: 'CONFIDENTIAL' };
      }
      return null;
    },
  };
}

function mount(opts: {
  dataSource?: DsarDataSource;
  classifications?: DsarClassificationLookup;
  bus?: { publish: (envelope: unknown) => Promise<void> };
  rtbfExecutor?: DsarRtbfExecutor | null;
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      dsarDataSource: opts.dataSource,
      dsarClassifications: opts.classifications,
      eventBus: opts.bus,
      dsarRtbfExecutor: opts.rtbfExecutor,
    } as never);
    await next();
  });
  app.route('/dsar', createDsarRouter());
  return app;
}

function stubRtbfExecutor(opts: {
  readonly tablesProcessed?: ReadonlyArray<{
    table: string;
    action: 'anonymized' | 'hard-deleted' | 'retained' | 'skipped';
    rowsAffected: number;
  }>;
  readonly totalRowsAffected?: number;
  readonly throwOn?: 'execute';
} = {}): DsarRtbfExecutor & { calls: { args: unknown }[] } {
  const calls: { args: unknown }[] = [];
  return {
    calls,
    async executeRtbf(args): Promise<RtbfExecutionReport> {
      calls.push({ args });
      if (opts.throwOn === 'execute') {
        throw new Error('boom');
      }
      return Object.freeze({
        subjectId: args.subjectId,
        subjectKind: 'customerId',
        executedAt: new Date('2026-05-15T10:00:00Z').toISOString(),
        requestedBy: args.requestedBy,
        dryRun: args.dryRun === true,
        tablesProcessed: Object.freeze(
          (opts.tablesProcessed ?? [
            { table: 'customers', action: 'anonymized', rowsAffected: 1 },
            { table: 'messages', action: 'hard-deleted', rowsAffected: 2 },
          ]).map((t) => Object.freeze({ ...t })),
        ) as unknown as RtbfExecutionReport['tablesProcessed'],
        partialErrors: Object.freeze([]),
        totalRowsAffected: opts.totalRowsAffected ?? 3,
      }) as RtbfExecutionReport;
    },
  } as DsarRtbfExecutor & { calls: { args: unknown }[] };
}

function bearer(role: UserRole, userId = 'usr-admin'): string {
  return `Bearer ${generateToken({
    userId,
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

describe('dsar.router', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  beforeEach(() => {
    _resetExportRateBucketForTests();
  });

  it('admin can export any subject', async () => {
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'cus_1', email: 'a@b.com' }],
    });
    const app = mount({ dataSource: ds, classifications: classificationLookup() });
    const res = await app.request('/dsar/cus_1/export', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment;/);
    const body = (await res.json()) as { tables: Record<string, unknown[]> };
    expect(body.tables.customers).toBeDefined();
    expect((body.tables.customers as unknown[]).length).toBe(1);
  });

  it('subject can export own bundle (matching userId)', async () => {
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'usr-self', email: 'self@b.com' }],
    });
    const app = mount({ dataSource: ds });
    const res = await app.request('/dsar/usr-self/export', {
      headers: { Authorization: bearer(UserRole.RESIDENT, 'usr-self') },
    });
    expect(res.status).toBe(200);
  });

  it('non-admin non-subject is 403', async () => {
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'cus_other', email: 'other@b.com' }],
    });
    const app = mount({ dataSource: ds });
    const res = await app.request('/dsar/cus_other/export', {
      headers: { Authorization: bearer(UserRole.RESIDENT, 'usr-different') },
    });
    expect(res.status).toBe(403);
  });

  it('subject not found returns empty bundle (not 404)', async () => {
    const ds = fixedSubjectDataSource({});
    const app = mount({ dataSource: ds });
    const res = await app.request('/dsar/unknown-subject/export', {
      headers: { Authorization: bearer(UserRole.ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tables: Record<string, unknown[]>;
      counts: Record<string, number>;
    };
    expect(body.tables).toBeDefined();
    // Every canonical table is shaped, even if empty.
    expect(Object.keys(body.tables).length).toBeGreaterThan(0);
  });

  it('classification annotations are present in the bundle', async () => {
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'cus_1', email: 'a@b.com', phone: '+254700000000' }],
    });
    const app = mount({ dataSource: ds, classifications: classificationLookup() });
    const res = await app.request('/dsar/cus_1/preview', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { classifications: Record<string, string> };
    };
    expect(body.data.classifications['customers.email']).toBe('CONFIDENTIAL');
  });

  it('audit emission fires on export', async () => {
    const captured: EventCapture[] = [];
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'cus_1', email: 'a@b.com' }],
    });
    const app = mount({ dataSource: ds, bus: captureBus(captured) });
    const res = await app.request('/dsar/cus_1/export', {
      headers: { Authorization: bearer(UserRole.ADMIN) },
    });
    expect(res.status).toBe(200);
    const exportEvents = captured.filter((e) => e.type === 'dsar.export');
    expect(exportEvents.length).toBe(1);
    const p = exportEvents[0].payload as {
      subjectId: string;
      tableCount: number;
      tenantId: string;
    };
    expect(p.subjectId).toBe('cus_1');
    expect(p.tableCount).toBeGreaterThan(0);
    expect(p.tenantId).toBe('tnt-test');
  });

  it('rate-limit triggers after 3 exports per tenant per hour', async () => {
    const ds = fixedSubjectDataSource({ customers: [] });
    const app = mount({ dataSource: ds });
    const auth = { Authorization: bearer(UserRole.SUPER_ADMIN) };
    // 3 successful calls
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/dsar/cus_${i}/export`, { headers: auth });
      expect(res.status).toBe(200);
    }
    // 4th call is rate-limited
    const res4 = await app.request('/dsar/cus_4/export', { headers: auth });
    expect(res4.status).toBe(429);
    const body = (await res4.json()) as {
      error: { code: string; retryAfter: number };
    };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.retryAfter).toBeGreaterThan(0);
  });

  it('RTBF without an executor returns 503 RTBF_EXECUTOR_UNAVAILABLE', async () => {
    const captured: EventCapture[] = [];
    const app = mount({ bus: captureBus(captured) });
    const res = await app.request('/dsar/cus_1/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('RTBF_EXECUTOR_UNAVAILABLE');
    // Audit row still fires so legal sees the attempt.
    expect(captured.some((e) => e.type === 'dsar.rtbf')).toBe(true);
  });

  it('RTBF SUPER_ADMIN dry-run returns 200 with full report and no mutations', async () => {
    const captured: EventCapture[] = [];
    const exec = stubRtbfExecutor();
    const app = mount({ bus: captureBus(captured), rtbfExecutor: exec });
    const res = await app.request('/dsar/cus_1/rtbf?dryRun=true', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: RtbfExecutionReport;
    };
    expect(body.success).toBe(true);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.subjectId).toBe('cus_1');
    expect(body.data.tablesProcessed.length).toBeGreaterThan(0);
    // Executor was invoked with dryRun=true.
    expect(exec.calls.length).toBe(1);
    const callArgs = exec.calls[0].args as { dryRun: boolean };
    expect(callArgs.dryRun).toBe(true);
  });

  it('RTBF ADMIN real run returns 200 and emits dsar.rtbf.executed audit event', async () => {
    const captured: EventCapture[] = [];
    const exec = stubRtbfExecutor({
      tablesProcessed: [
        { table: 'customers', action: 'anonymized', rowsAffected: 1 },
        { table: 'messages', action: 'hard-deleted', rowsAffected: 3 },
        { table: 'audit_events', action: 'retained', rowsAffected: 5 },
      ],
      totalRowsAffected: 9,
    });
    const app = mount({ bus: captureBus(captured), rtbfExecutor: exec });
    const res = await app.request('/dsar/cus_1/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: RtbfExecutionReport };
    expect(body.data.totalRowsAffected).toBe(9);
    const audit = captured.find((e) => e.type === 'dsar.rtbf.executed');
    expect(audit).toBeDefined();
    const p = audit!.payload as {
      subjectId: string;
      totalRowsAffected: number;
      tableActions: Array<{ table: string; action: string }>;
    };
    expect(p.subjectId).toBe('cus_1');
    expect(p.totalRowsAffected).toBe(9);
    expect(p.tableActions.length).toBe(3);
  });

  it('RTBF is forbidden for RESIDENT (non-admin)', async () => {
    const exec = stubRtbfExecutor();
    const app = mount({ rtbfExecutor: exec });
    const res = await app.request('/dsar/cus_1/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
    // Executor MUST NOT be called for forbidden roles.
    expect(exec.calls.length).toBe(0);
  });

  it('RTBF is forbidden for TENANT_ADMIN (platform-level review required)', async () => {
    const exec = stubRtbfExecutor();
    const app = mount({ rtbfExecutor: exec });
    const res = await app.request('/dsar/cus_1/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(403);
    expect(exec.calls.length).toBe(0);
  });

  it('RTBF with malformed subjectId returns 400', async () => {
    const exec = stubRtbfExecutor();
    const app = mount({ rtbfExecutor: exec });
    // Hono's path matching treats an empty segment as no match — to
    // simulate a malformed body request we send a whitespace-only id
    // (the router trims and rejects).
    const res = await app.request('/dsar/%20/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(400);
    expect(exec.calls.length).toBe(0);
  });

  it('RTBF executor errors propagate as 500 DSAR_RTBF_FAILED', async () => {
    const exec = stubRtbfExecutor({ throwOn: 'execute' });
    const app = mount({ rtbfExecutor: exec });
    const res = await app.request('/dsar/cus_1/rtbf', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(500);
  });

  it('export without auth is 401', async () => {
    const app = mount({});
    const res = await app.request('/dsar/cus_1/export');
    expect(res.status).toBe(401);
  });

  it('subject-self preview works without admin role', async () => {
    const ds = fixedSubjectDataSource({
      customers: [{ id: 'usr-self', email: 'me@b.com' }],
    });
    const app = mount({ dataSource: ds });
    const res = await app.request('/dsar/usr-self/preview', {
      headers: { Authorization: bearer(UserRole.RESIDENT, 'usr-self') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
