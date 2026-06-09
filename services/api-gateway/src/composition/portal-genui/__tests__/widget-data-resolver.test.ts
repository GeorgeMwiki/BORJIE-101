/**
 * Widget-data resolver + endpoint tests (W2a).
 *
 * Two layers:
 *
 *   1. UNIT — the generic resolver in isolation against an in-memory record
 *      store + a stub query port. Locks the generative contract: a `tab_records`
 *      query returns the tab's own records as rows; an unknown resource/tool is
 *      REJECTED (UnknownBindingError); a known-but-unmapped resource degrades to
 *      empty rows (never throws → never 500); a mapped resource resolves through
 *      the bounded, tenant-scoped SELECT on the query port; a tool binding is
 *      vetted but returns empty rows (read-only tool dispatch is a later seam).
 *
 *   2. ENDPOINT — the router's POST /tabs/:id/widget-data mounted with an
 *      in-memory engine + record store. Confirms a query binding to tab_records
 *      returns the persisted records as rows, an unknown resource answers 400,
 *      and a cross-tenant / missing tab answers 404.
 *
 * No DB / LLM is set, so everything runs in the deterministic degraded mode the
 * gateway boots in for test/smoke.
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { describe, it, expect } from 'vitest';
import {
  createGenUIEngine,
  createInMemoryRecordStore,
  type PortalTab,
  type RecordStore,
} from '@borjie/portal-genui';

import {
  createWidgetDataResolver,
  UnknownBindingError,
  type WidgetQueryPort,
} from '../widget-data-resolver.js';

const NOOP_LOGGER = {
  warn: (_meta: Record<string, unknown>, _msg: string) => undefined,
  info: (_meta: Record<string, unknown>, _msg: string) => undefined,
};

/** A query port that records the SQL it was asked to run + returns canned rows. */
function stubQueryPort(rows: ReadonlyArray<Record<string, unknown>>): {
  port: WidgetQueryPort;
  calls: Array<{ sql: string; params: ReadonlyArray<unknown> }>;
} {
  const calls: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  return {
    calls,
    port: {
      async query<Row = Record<string, unknown>>(
        sql: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<ReadonlyArray<Row>> {
        calls.push({ sql, params: params ?? [] });
        return rows as ReadonlyArray<Row>;
      },
    },
  };
}

/**
 * Build a COMPLETE, valid record payload from a tab's writable fields — a
 * kind-appropriate value per field so the record store's
 * generated-from-the-tab validator accepts it (required fields present,
 * dropdown→an option, number/currency→in-range, date→YYYY-MM-DD).
 */
function validPayloadFor(tab: PortalTab): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of tab.sections) {
    for (const f of section.fields) {
      if ((f as { readonly?: boolean }).readonly === true) continue;
      const field = f as {
        key: string;
        kind: string;
        min?: number;
        options?: ReadonlyArray<{ value: string }>;
      };
      switch (field.kind) {
        case 'number':
        case 'currency':
        case 'percent':
          out[field.key] = typeof field.min === 'number' ? field.min : 1;
          break;
        case 'rating':
          out[field.key] = typeof field.min === 'number' ? field.min : 1;
          break;
        case 'date':
          out[field.key] = '2026-06-01';
          break;
        case 'datetime':
          out[field.key] = '2026-06-01T08:00:00.000Z';
          break;
        case 'boolean':
        case 'toggle':
          out[field.key] = true;
          break;
        case 'dropdown':
          out[field.key] = field.options?.[0]?.value ?? 'value';
          break;
        case 'multi_select':
          out[field.key] = [field.options?.[0]?.value ?? 'value'];
          break;
        case 'email':
          out[field.key] = 'owner@example.com';
          break;
        case 'phone':
        case 'phone_number':
          out[field.key] = '+255700000000';
          break;
        case 'url':
        case 'file_upload':
        case 'image_upload':
          out[field.key] = 'https://assets.borjie.com/x.pdf';
          break;
        default:
          out[field.key] = 'value';
      }
    }
  }
  return out;
}

/** A generated tab via the deterministic generator — a real, valid PortalTab. */
async function makeTab(tenantId: string): Promise<PortalTab> {
  const engine = createGenUIEngine();
  const intent = await engine.detectIntent({
    message: 'we need to track our staff payroll',
  });
  const result = await engine.generate({
    intent: intent!,
    tenantId,
    userId: 'user_1',
    actorId: 'user_1',
  });
  return result.tab;
}

describe('createWidgetDataResolver — unit', () => {
  it('resolves a tab_records query to the tab’s own records as rows', async () => {
    const recordStore: RecordStore = createInMemoryRecordStore();
    const tab = await makeTab('tenant_A');
    // Seed two records on the tab so the resolver has rows to return.
    const payload = validPayloadFor(tab);
    await recordStore.saveRecord({
      tenantId: 'tenant_A',
      tab,
      payload,
      userId: 'user_1',
    });
    await recordStore.saveRecord({
      tenantId: 'tenant_A',
      tab,
      payload,
      userId: 'user_1',
    });

    const resolver = createWidgetDataResolver({ recordStore, logger: NOOP_LOGGER });
    const data = await resolver.resolve(
      { kind: 'query', resource: 'tab_records' },
      { tenantId: 'tenant_A', tabId: tab.id },
    );
    expect(data.rows).toHaveLength(2);
    expect(data.rows?.[0]).toHaveProperty('id');
    expect(data.rows?.[0]).toHaveProperty('createdAt');
  });

  it('rejects an unknown query resource with UnknownBindingError', async () => {
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      logger: NOOP_LOGGER,
    });
    await expect(
      resolver.resolve(
        { kind: 'query', resource: 'definitely_not_a_resource' },
        { tenantId: 'tenant_A', tabId: 'tab_x' },
      ),
    ).rejects.toBeInstanceOf(UnknownBindingError);
  });

  it('returns empty rows for a known-but-unmapped resource (no throw, no 500)', async () => {
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      logger: NOOP_LOGGER,
    });
    // `royalty_returns` is a vetted resource but has no table mapping yet.
    const data = await resolver.resolve(
      { kind: 'query', resource: 'royalty_returns' },
      { tenantId: 'tenant_A', tabId: 'tab_x' },
    );
    expect(data.rows).toEqual([]);
  });

  it('resolves a mapped resource through a bounded tenant-scoped SELECT', async () => {
    const { port, calls } = stubQueryPort([{ id: 'lic_1', tenant_id: 'tenant_A' }]);
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      query: port,
      logger: NOOP_LOGGER,
    });
    const data = await resolver.resolve(
      { kind: 'query', resource: 'licences' },
      { tenantId: 'tenant_A', tabId: 'tab_x' },
    );
    expect(data.rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('FROM public.licences');
    expect(calls[0]?.sql).toContain('WHERE tenant_id = $1');
    expect(calls[0]?.sql).toContain('LIMIT $2');
    expect(calls[0]?.params[0]).toBe('tenant_A');
  });

  it('vets a tool binding but returns empty rows (read-only dispatch is a later seam)', async () => {
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      logger: NOOP_LOGGER,
    });
    const data = await resolver.resolve(
      { kind: 'tool', toolId: 'create_reminder' },
      { tenantId: 'tenant_A', tabId: 'tab_x' },
    );
    expect(data.rows).toEqual([]);
  });

  it('rejects an unknown tool with UnknownBindingError', async () => {
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      logger: NOOP_LOGGER,
    });
    await expect(
      resolver.resolve(
        { kind: 'tool', toolId: 'drain_the_treasury' },
        { tenantId: 'tenant_A', tabId: 'tab_x' },
      ),
    ).rejects.toBeInstanceOf(UnknownBindingError);
  });

  it('degrades a mapped read failure to empty rows (never propagates a throw)', async () => {
    const failingPort: WidgetQueryPort = {
      async query() {
        throw new Error('connection reset');
      },
    };
    const resolver = createWidgetDataResolver({
      recordStore: createInMemoryRecordStore(),
      query: failingPort,
      logger: NOOP_LOGGER,
    });
    const data = await resolver.resolve(
      { kind: 'query', resource: 'employees' },
      { tenantId: 'tenant_A', tabId: 'tab_x' },
    );
    expect(data.rows).toEqual([]);
  });
});

describe('POST /tabs/:id/widget-data — endpoint', () => {
  async function mountedApp(deps: {
    engine: ReturnType<typeof createGenUIEngine>;
    recordStore: RecordStore;
  }) {
    const { Hono } = await import('hono');
    const router = (await import('../../../routes/portal-genui/portal-genui.router.js'))
      .default;
    const app = new Hono();
    // Inject the service bag the router reads BEFORE the router runs.
    app.use('*', async (c, next) => {
      c.set('services', {
        portalGenUIEngine: deps.engine,
        portalGenUIRecordStore: deps.recordStore,
      });
      await next();
    });
    app.route('/portal-genui', router);
    return app;
  }

  async function token() {
    const { generateToken } = await import('../../../middleware/auth.js');
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ??
      'test-secret-jwt-0123456789abcdef0123456789abcdef';
    return generateToken({
      userId: 'user_1',
      tenantId: 'tenant_A',
      role: 'super_admin' as never,
      permissions: [],
      propertyAccess: ['*'],
    });
  }

  it('returns the tab’s records as rows for a tab_records query binding', async () => {
    const engine = createGenUIEngine();
    const recordStore = createInMemoryRecordStore();
    const tab = await makeTab('tenant_A');
    await engine.persist({ tab });
    await recordStore.saveRecord({
      tenantId: 'tenant_A',
      tab,
      payload: validPayloadFor(tab),
      userId: 'user_1',
    });

    const app = await mountedApp({ engine, recordStore });
    const res = await app.request(
      `/portal-genui/tabs/${encodeURIComponent(tab.id)}/widget-data`,
      {
        method: 'POST',
        body: JSON.stringify({ binding: { kind: 'query', resource: 'tab_records' } }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await token()}`,
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { rows?: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(1);
  });

  it('answers 400 for an unknown resource in the binding', async () => {
    const engine = createGenUIEngine();
    const recordStore = createInMemoryRecordStore();
    const tab = await makeTab('tenant_A');
    await engine.persist({ tab });

    const app = await mountedApp({ engine, recordStore });
    const res = await app.request(
      `/portal-genui/tabs/${encodeURIComponent(tab.id)}/widget-data`,
      {
        method: 'POST',
        body: JSON.stringify({
          binding: { kind: 'query', resource: 'arbitrary_table' },
        }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await token()}`,
        },
      },
    );
    // The discriminated-union schema accepts the string; the resolver rejects
    // the unknown NAME → 400 UNKNOWN_BINDING. Either way the caller cannot
    // probe an off-list token.
    expect(res.status).toBe(400);
  });

  it('answers 404 for a tab outside the caller’s tenant', async () => {
    const engine = createGenUIEngine();
    const recordStore = createInMemoryRecordStore();
    // Tab belongs to a DIFFERENT tenant than the JWT (tenant_A).
    const tab = await makeTab('tenant_OTHER');
    await engine.persist({ tab });

    const app = await mountedApp({ engine, recordStore });
    const res = await app.request(
      `/portal-genui/tabs/${encodeURIComponent(tab.id)}/widget-data`,
      {
        method: 'POST',
        body: JSON.stringify({ binding: { kind: 'query', resource: 'tab_records' } }),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await token()}`,
        },
      },
    );
    expect(res.status).toBe(404);
  });
});
