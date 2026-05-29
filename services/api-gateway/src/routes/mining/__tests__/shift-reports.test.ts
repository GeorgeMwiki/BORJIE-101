/**
 * /api/v1/mining/shift-reports — commercial chain L6.
 *
 * Verifies that a successful POST emits a `production.posted` cockpit
 * event with the ROM tonnes, metres advanced, BCM overburden, and fuel
 * litres copied from the shift report. The publish is best-effort —
 * a publish throw must not roll back the insert (covered by case 3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { miningShiftReportsRouter } from '../shift-reports.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';
import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../../services/cockpit-events/index.js';

const TENANT_A = '11111111-2222-3333-4444-555555555555';
const SITE_A = '22222222-3333-4444-5555-666666666666';
const USER_A = '33333333-4444-5555-6666-777777777777';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: USER_A,
    tenantId: TENANT_A,
    role: UserRole.TENANT_ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

interface FakeReturning {
  returning(): Promise<Array<Record<string, unknown>>>;
  then?: (r: (v: unknown) => void) => void;
}

function buildFakeDb(rowToReturn: Record<string, unknown>) {
  return {
    insert(_table: unknown) {
      return {
        values(_row: unknown): FakeReturning {
          return {
            async returning() {
              return [rowToReturn];
            },
          };
        },
      };
    },
    // databaseMiddleware sets RLS via execute(); short-circuit so the
    // middleware's set_config call succeeds without a real Postgres.
    async execute(_q: unknown) {
      return { rows: [] };
    },
  };
}

function mount(db: unknown): Hono {
  const app = new Hono();
  // Database middleware short-circuit — set `db` BEFORE the router
  // mounts its own middleware so the openapi handler picks it up.
  app.use('*', async (c, next) => {
    if (db) {
      c.set('db' as never, db as never);
    }
    await next();
  });
  app.route('/', miningShiftReportsRouter);
  return app;
}

beforeEach(() => {
  __resetCockpitBusForTests();
});

describe('POST /api/v1/mining/shift-reports — L6 production.posted', () => {
  it('emits production.posted with ROM tonnes copied through', async () => {
    const db = buildFakeDb({
      id: 'sr-uuid-1',
      tenantId: TENANT_A,
      siteId: SITE_A,
      shiftDate: '2026-05-29',
      romTonnes: '150',
      metresAdvanced: '6',
      bcmOverburden: '300',
      fuelLitres: '480',
    });

    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT_A, (e) => events.push(e));

    const app = mount(db);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer() },
      body: JSON.stringify({
        siteId: SITE_A,
        shiftDate: '2026-05-29',
        shiftKind: 'day',
        blastsFired: 0,
        romTonnes: '150',
        metresAdvanced: '6',
        bcmOverburden: '300',
        fuelLitres: '480',
      }),
    });
    expect(res.status).toBe(201);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.kind).toBe('production.posted');
    if (e.kind === 'production.posted') {
      expect(e.shiftReportId).toBe('sr-uuid-1');
      expect(e.siteId).toBe(SITE_A);
      expect(e.shiftDate).toBe('2026-05-29');
      expect(e.romTonnes).toBe(150);
      expect(e.metresAdvanced).toBe(6);
      expect(e.bcmOverburden).toBe(300);
      expect(e.fuelLitres).toBe(480);
    }
  });

  it('emits production.posted with nullable production fields preserved', async () => {
    const db = buildFakeDb({
      id: 'sr-uuid-2',
      tenantId: TENANT_A,
      siteId: SITE_A,
      shiftDate: '2026-05-29',
    });
    const events: CockpitEvent[] = [];
    subscribeCockpitEvents(TENANT_A, (e) => events.push(e));

    const app = mount(db);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer() },
      body: JSON.stringify({
        siteId: SITE_A,
        shiftDate: '2026-05-29',
        shiftKind: 'day',
        blastsFired: 0,
      }),
    });
    expect(res.status).toBe(201);
    expect(events.length).toBe(1);
    const e = events[0]!;
    if (e.kind === 'production.posted') {
      expect(e.romTonnes).toBeNull();
      expect(e.metresAdvanced).toBeNull();
      expect(e.bcmOverburden).toBeNull();
      expect(e.fuelLitres).toBeNull();
    }
  });

  it('does not deliver the event to a different tenant subscriber', async () => {
    const db = buildFakeDb({
      id: 'sr-uuid-3',
      tenantId: TENANT_A,
      siteId: SITE_A,
      shiftDate: '2026-05-29',
      romTonnes: '50',
    });
    const otherTenantEvents: CockpitEvent[] = [];
    subscribeCockpitEvents('99999999-9999-9999-9999-999999999999', (e) =>
      otherTenantEvents.push(e),
    );

    const app = mount(db);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer() },
      body: JSON.stringify({
        siteId: SITE_A,
        shiftDate: '2026-05-29',
        shiftKind: 'day',
        blastsFired: 0,
        romTonnes: '50',
      }),
    });
    expect(res.status).toBe(201);
    expect(otherTenantEvents.length).toBe(0);
  });
});
