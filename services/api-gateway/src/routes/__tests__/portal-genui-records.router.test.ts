/**
 * portal-genui records endpoints (Keystone K1a).
 *
 * Covers POST /tabs/:id/records (validate-against-tab-fields + insert) and
 * GET /tabs/:id/records (list), with the engine + the in-memory record store
 * both injected via `c.set('services', { portalGenUIEngine, portalGenUIRecordStore })`.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createGenUIEngine,
  createInMemoryRecordStore,
  type PortalTab,
} from '@borjie/portal-genui';
import portalGenUIRouter from '../portal-genui/portal-genui.router.js';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

function bearer(opts: { tenantId?: string } = {}): string {
  return `Bearer ${generateToken({
    userId: 'user_1',
    tenantId: opts.tenantId ?? 'tenant_1',
    role: UserRole.SUPER_ADMIN as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

/** A record-collecting tab with required + dropdown + min/max fields. */
function recordTab(tenantId = 'tenant_1'): PortalTab {
  return {
    id: 'tab_payroll',
    version: 1,
    tenantId,
    userId: 'user_1',
    tabKey: 'hr.payroll',
    title: 'Payroll',
    description: 'Staff payroll records',
    icon: 'banknote',
    domain: 'hr',
    sections: [
      {
        key: 'payroll',
        title: 'Payroll',
        fields: [
          { key: 'name', label: 'Name', kind: 'text', required: true },
          {
            key: 'department',
            label: 'Department',
            kind: 'dropdown',
            required: true,
            options: [
              { value: 'extraction', label: 'Extraction' },
              { value: 'processing', label: 'Processing' },
            ],
          },
          {
            key: 'salary',
            label: 'Salary',
            kind: 'number',
            required: true,
            min: 0,
            max: 10_000_000,
          },
        ],
        widgets: [],
      },
    ],
    permissions: { visibleToPersonas: ['internal_admin'] },
    record: { enabled: true },
    audit: {
      createdBy: 'system',
      updatedBy: 'system',
      history: [],
    },
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:00:00.000Z',
  };
}

async function appWithTab(tenantId = 'tenant_1'): Promise<{
  app: Hono;
  tab: PortalTab;
}> {
  const engine = createGenUIEngine();
  const recordStore = createInMemoryRecordStore();
  const tab = recordTab(tenantId);
  await engine.persist({ tab });

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      portalGenUIEngine: engine,
      portalGenUIRecordStore: recordStore,
    } as never);
    await next();
  });
  app.route('/portal-genui', portalGenUIRouter);
  return { app, tab };
}

describe('portal-genui records — auth gates', () => {
  it('rejects POST /tabs/:id/records without a token', async () => {
    const { app } = await appWithTab();
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      method: 'POST',
      body: JSON.stringify({ payload: {} }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /tabs/:id/records without a token', async () => {
    const { app } = await appWithTab();
    const res = await app.request('/portal-genui/tabs/tab_payroll/records');
    expect(res.status).toBe(401);
  });
});

describe('portal-genui records — POST /tabs/:id/records', () => {
  it('accepts a valid payload and returns 201 { id }', async () => {
    const { app } = await appWithTab();
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      method: 'POST',
      body: JSON.stringify({
        payload: { name: 'Asha', department: 'extraction', salary: 1_500_000 },
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();
  });

  it('rejects a bad payload with 422 + the failing field keys', async () => {
    const { app } = await appWithTab();
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      method: 'POST',
      body: JSON.stringify({
        // missing required `name`; dropdown out of options; salary over max.
        payload: { department: 'NOPE', salary: 99_999_999 },
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; invalidFieldKeys: string[] };
    };
    expect(body.error.code).toBe('RECORD_VALIDATION_FAILED');
    expect(body.error.invalidFieldKeys).toEqual(
      expect.arrayContaining(['name', 'department', 'salary']),
    );
  });

  it('404 when the tab belongs to another tenant', async () => {
    const { app } = await appWithTab('tenant_OTHER');
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      method: 'POST',
      body: JSON.stringify({
        payload: { name: 'Asha', department: 'extraction', salary: 1 },
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer({ tenantId: 'tenant_1' }),
      },
    });
    expect(res.status).toBe(404);
  });

  it('404 on an unknown tab id', async () => {
    const { app } = await appWithTab();
    const res = await app.request('/portal-genui/tabs/missing/records', {
      method: 'POST',
      body: JSON.stringify({ payload: { name: 'x' } }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('portal-genui records — GET /tabs/:id/records', () => {
  it('lists records for the tab', async () => {
    const { app } = await appWithTab();
    await app.request('/portal-genui/tabs/tab_payroll/records', {
      method: 'POST',
      body: JSON.stringify({
        payload: { name: 'Asha', department: 'extraction', salary: 1 },
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { records: Array<{ payload: { name: string } }> };
    };
    expect(body.data.records.length).toBe(1);
    expect(body.data.records[0]?.payload.name).toBe('Asha');
  });

  it('503 when the record store is not wired', async () => {
    const engine = createGenUIEngine();
    await engine.persist({ tab: recordTab() });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('services', { portalGenUIEngine: engine } as never); // no record store
      await next();
    });
    app.route('/portal-genui', portalGenUIRouter);
    const res = await app.request('/portal-genui/tabs/tab_payroll/records', {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PORTAL_GENUI_RECORD_STORE_MISSING');
  });
});
