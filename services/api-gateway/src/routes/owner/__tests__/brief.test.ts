/**
 * GET /api/v1/owner/brief — router smoke tests.
 *
 * Wave OWNER-HOME. Asserts:
 *   - 401 when no Authorization header is provided
 *   - 200 + cached=true when today's snapshot already exists in
 *     `owner_brief_snapshots`
 *   - 200 + cached=false when no snapshot exists (on-demand compose);
 *     the route also persists a fresh row via the INSERT… ON CONFLICT
 *     path inside `persistSnapshot()`.
 *   - 200 + empty sections when all sub-services return zero rows
 *     (degenerate-but-valid tenant).
 *   - 503 when no `db` is bound on the request context.
 *   - composeOwnerBrief() pure helper composes seven slots in parallel
 *     and validates against the OwnerBriefSchema.
 *
 * The DB layer is faked with a thin `StubDb` that intercepts both the
 * Drizzle query-builder methods (select/from/where/orderBy/limit/groupBy)
 * and raw `execute(sql)` calls used by the SQL-only helpers. This is the
 * same pattern as `services/api-gateway/src/routes/__tests__/pilot-feedback.test.ts`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// JWT secret + NODE_ENV must be set BEFORE importing the router so the
// auth middleware captures the secret at module init. Mirrors the
// pattern in pilot-feedback.test.ts.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createOwnerBriefRouter,
  composeOwnerBrief,
  computeCashRunway,
  OwnerBriefSchema,
} from '../brief.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

// ---------------------------------------------------------------------------
// Stub DB — intercepts both Drizzle's fluent select() chain and raw
// execute(sql) calls. Returns `defaultRows` (or per-table overrides) so
// each slot computer can pretend to have read its table.
// ---------------------------------------------------------------------------

interface StubDbConfig {
  /** Rows returned by raw db.execute(sql`SELECT…`). */
  readonly execRows: ReadonlyArray<Record<string, unknown>>;
  /** Rows returned by Drizzle fluent SELECTs by table name. */
  readonly tableRows: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>;
  /** Rows returned for the snapshot-cache lookup specifically. */
  readonly snapshotCacheRows: ReadonlyArray<Record<string, unknown>>;
  /** Rows returned by INSERT … RETURNING (snapshot row). */
  readonly insertReturning: ReadonlyArray<Record<string, unknown>>;
}

function makeStubDb(
  cfg: Partial<StubDbConfig> = {},
): {
  readonly db: any;
  readonly executeCalls: ReadonlyArray<string>;
} {
  const config: StubDbConfig = {
    execRows: cfg.execRows ?? [],
    tableRows: cfg.tableRows ?? {},
    snapshotCacheRows: cfg.snapshotCacheRows ?? [],
    insertReturning:
      cfg.insertReturning ?? [{ id: 'snap-1', hash_chain_id: null }],
  };
  const executeCalls: string[] = [];

  function buildChain(seedRows: ReadonlyArray<Record<string, unknown>>): any {
    // Each terminal Drizzle method resolves the chain; we model that by
    // returning a thenable on every chain operation, but allow further
    // method calls before await. Easiest model: return a chain object
    // whose every chained method returns itself, AND whose `then` calls
    // resolve(rows).
    const chain: any = {
      _rows: seedRows,
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      groupBy() {
        return chain;
      },
      then(resolve: (rows: any) => void) {
        resolve(chain._rows);
      },
    };
    return chain;
  }

  function tableNameFrom(source: unknown): string | null {
    if (!source || typeof source !== 'object') return null;
    const s = source as Record<string, unknown>;
    // Drizzle pg-core tables expose the physical name via the
    // `Symbol(drizzle:Name)` / `Symbol(drizzle:BaseName)` symbols.
    // Modern drizzle stores the table name as a string directly under
    // these symbols (not nested inside `.name`).
    const symbols = Object.getOwnPropertySymbols(s);
    for (const sym of symbols) {
      const desc = sym.description ?? sym.toString();
      if (
        desc === 'drizzle:Name' ||
        desc === 'drizzle:BaseName' ||
        desc === 'drizzle:OriginalName'
      ) {
        const v = (s as any)[sym];
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && typeof v.name === 'string') {
          return v.name as string;
        }
      }
    }
    return null;
  }

  function sqlText(query: unknown): string {
    if (!query || typeof query !== 'object') return '';
    const q = query as { queryChunks?: unknown };
    if (!Array.isArray(q.queryChunks)) {
      const s = String((query as any).toString?.());
      return s === '[object Object]' ? '' : s;
    }
    let out = '';
    for (const chunk of q.queryChunks) {
      if (typeof chunk === 'string') {
        out += chunk;
      } else if (chunk && typeof chunk === 'object') {
        const c = chunk as { value?: unknown };
        if (typeof c.value === 'string') {
          out += c.value;
        } else if (Array.isArray(c.value)) {
          out += c.value.filter((v) => typeof v === 'string').join('');
        } else if (Array.isArray((chunk as any).queryChunks)) {
          out += sqlText(chunk);
        }
      }
    }
    return out;
  }

  const db: any = {
    async execute(query: unknown) {
      const text = sqlText(query);
      executeCalls.push(text);
      // Route specific kinds of queries to their stub data. We can't
      // reliably parse Drizzle's sql template, so we key off
      // distinguishing substrings.
      if (text.includes('owner_brief_snapshots')) {
        if (text.toUpperCase().includes('INSERT')) {
          return { rows: config.insertReturning };
        }
        return { rows: config.snapshotCacheRows };
      }
      if (text.includes('ai_audit_chain')) {
        // chain append → return a fake id row
        return { rows: [{ id: 'audit-1' }] };
      }
      if (text.includes('grievances')) {
        return { rows: [] };
      }
      return { rows: config.execRows };
    },
    select(_projection?: unknown) {
      return {
        from(source: unknown) {
          const name = tableNameFrom(source);
          const seed = name ? config.tableRows[name] ?? [] : [];
          return buildChain(seed);
        },
      };
    },
  };

  return { db, executeCalls };
}

/**
 * Wrap a stub `execute` so the two cash-runway SQL reads (cash_balances /
 * costs) resolve to distinct row sets keyed by a SQL substring. Any other
 * query falls through to the original stub `execute`.
 */
function routeRunwayExecute(
  original: (q: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>,
  rows: {
    readonly cash: ReadonlyArray<Record<string, unknown>>;
    readonly burn: ReadonlyArray<Record<string, unknown>>;
  },
): (q: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }> {
  function extract(query: unknown): string {
    if (!query || typeof query !== 'object') return '';
    const q = query as { queryChunks?: unknown };
    if (!Array.isArray(q.queryChunks)) return '';
    let out = '';
    for (const chunk of q.queryChunks) {
      if (typeof chunk === 'string') out += chunk;
      else if (chunk && typeof chunk === 'object') {
        const c = chunk as { value?: unknown };
        if (typeof c.value === 'string') out += c.value;
        else if (Array.isArray(c.value))
          out += c.value.filter((v) => typeof v === 'string').join('');
        else if (Array.isArray((chunk as { queryChunks?: unknown }).queryChunks))
          out += extract(chunk);
      }
    }
    return out;
  }
  return async (q: unknown) => {
    const text = extract(q);
    if (text.includes('cash_balances')) return { rows: rows.cash };
    if (text.includes('costs')) return { rows: rows.burn };
    return original(q);
  };
}

function bearer(): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: '00000000-0000-0000-0000-000000000001',
    role: UserRole.OWNER as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(db: any): Hono {
  const app = new Hono();
  // Pre-bind `db` on the context so the route's own `databaseMiddleware`
  // sees the injected client and skips creating its own.
  app.use('*', async (c: any, next) => {
    if (db) c.set('db', db);
    await next();
  });
  app.route('/api/v1/owner/brief', createOwnerBriefRouter());
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/owner/brief — auth', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const { db } = makeStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/owner/brief', { method: 'GET' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });
});

describe('GET /api/v1/owner/brief — cache read', () => {
  it('returns 200 + cached=true when today\'s snapshot exists', async () => {
    const validBrief = {
      schemaVersion: 1,
      composedAtIso: '2026-05-27T03:00:00.000Z',
      dailyBrief: {
        date: '2026-05-27',
        shiftsToday: 0,
        openIncidents: 0,
        openGrievances: 0,
        criticalIncidents: 0,
      },
      decisions: { pendingCount: 0, items: [] },
      cashRunway: { ninetyDayNetTzs: 0, dailyAvgTzs: 0, sampleCount: 0 },
      productionVsTarget: { window: '30d' as const, perSite: [] },
      cliffStatus: {
        cliffDateIso: '2026-03-27T00:00:00.000Z',
        postCliffSales: 0,
        usdDenominated: 0,
        remediationComplete: true,
      },
      openHighIncidents: { count: 0, items: [] },
      licenceHealth: { totalCount: 0, atRiskCount: 0, items: [] },
    };
    const { db } = makeStubDb({
      tableRows: {
        owner_brief_snapshots: [
          {
            brief: validBrief,
            source: 'cron',
            generatedAt: new Date('2026-05-27T03:00:00.000Z'),
          },
        ],
      },
    });
    const app = mount(db);
    const res = await app.request('/api/v1/owner/brief', {
      method: 'GET',
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        cached: boolean;
        source: string;
        brief: { schemaVersion: number };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.cached).toBe(true);
    expect(body.data.source).toBe('cron');
    expect(body.data.brief.schemaVersion).toBe(1);
  });
});

describe('GET /api/v1/owner/brief — on-demand compose', () => {
  it('returns 200 + cached=false when no snapshot exists and composes inline', async () => {
    const { db, executeCalls } = makeStubDb({
      // owner_brief_snapshots SELECT returns no row → cache miss
      tableRows: {
        owner_brief_snapshots: [],
      },
    });
    const app = mount(db);
    const res = await app.request('/api/v1/owner/brief', {
      method: 'GET',
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { cached: boolean; source: string; brief: unknown };
    };
    expect(body.success).toBe(true);
    expect(body.data.cached).toBe(false);
    expect(body.data.source).toBe('on-demand');
    // Snapshot persisted: at least one INSERT into owner_brief_snapshots.
    const hasInsert = executeCalls.some(
      (sql) =>
        sql.includes('owner_brief_snapshots') &&
        sql.toUpperCase().includes('INSERT'),
    );
    expect(hasInsert).toBe(true);
    // Schema validates against the runtime parser.
    const parsed = OwnerBriefSchema.safeParse(
      (body.data as { brief: unknown }).brief,
    );
    expect(parsed.success).toBe(true);
  });

  it('returns 200 with empty sections when every sub-service returns no data', async () => {
    const { db } = makeStubDb({});
    const app = mount(db);
    const res = await app.request('/api/v1/owner/brief', {
      method: 'GET',
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        brief: {
          dailyBrief: { shiftsToday: number; openIncidents: number };
          openHighIncidents: { count: number };
          licenceHealth: { totalCount: number };
        };
      };
    };
    expect(body.data.brief.dailyBrief.shiftsToday).toBe(0);
    expect(body.data.brief.dailyBrief.openIncidents).toBe(0);
    expect(body.data.brief.openHighIncidents.count).toBe(0);
    expect(body.data.brief.licenceHealth.totalCount).toBe(0);
  });
});

describe('GET /api/v1/owner/brief — degraded mode', () => {
  it('returns 503 when no db is bound on the context', async () => {
    const app = mount(null);
    const res = await app.request('/api/v1/owner/brief', {
      method: 'GET',
      headers: { Authorization: bearer() },
    });
    // databaseMiddleware will short-circuit with 503 LIVE_DATA_NOT_CONFIGURED
    // when no DB is wired AND USE_MOCK_DATA is unset.
    expect([500, 503]).toContain(res.status);
  });
});

describe('composeOwnerBrief() — service-layer composition', () => {
  it('composes a fully-formed brief from seven slots in parallel', async () => {
    const { db } = makeStubDb({
      tableRows: {
        shift_reports: [
          { id: 's1', tenantId: 't1', siteId: 'site-a' },
          { id: 's2', tenantId: 't1', siteId: 'site-a' },
        ],
        incidents: [
          {
            id: 'i1',
            severity: 'critical',
            kind: 'safety',
            occurredAt: new Date('2026-05-27T01:00:00.000Z'),
          },
        ],
        licences: [
          {
            id: 'l1',
            number: 'PML-001',
            kind: 'PML',
            expiryDate: '2026-08-01',
            dormancyScore: 30,
          },
        ],
        sales: [],
      },
    });
    const brief = await composeOwnerBrief(db, 't1');
    const parsed = OwnerBriefSchema.safeParse(brief);
    expect(parsed.success).toBe(true);
    expect(brief.schemaVersion).toBe(1);
    expect(brief.dailyBrief.shiftsToday).toBe(2);
    expect(brief.openHighIncidents.count).toBe(1);
    expect(brief.licenceHealth.totalCount).toBe(1);
    expect(brief.cashRunway.sampleCount).toBe(0);
    expect(brief.productionVsTarget.window).toBe('30d');
    expect(brief.cliffStatus.remediationComplete).toBe(true);
  });

  it('computes a REAL runway from the cash + cost feeds (not the constant 90)', async () => {
    // Route the two runway SQL reads to distinct row sets by SQL substring.
    // cash 900M, burn 10M/day → runway = floor(900M / 10M) = 90, but a REAL
    // 90 derived from INDEPENDENT cash + burn, not the degenerate ratio.
    const { db } = makeStubDb({ tableRows: { sales: [] } });
    db.execute = routeRunwayExecute(db.execute, {
      cash: [{ cash_total: '900000000', account_count: 3 }],
      burn: [{ daily_burn: '10000000', cost_rows: 12 }],
    });
    const brief = await composeOwnerBrief(db, 't1');
    expect(brief.cashRunway.cashOnHandTzs).toBe(900_000_000);
    expect(brief.cashRunway.netDailyBurnTzs).toBe(10_000_000);
    expect(brief.cashRunway.burnStatus).toBe('burning');
    expect(brief.cashRunway.runwayDays).toBe(90);
  });

  it('returns honest UNKNOWN runway when the treasury + cost feeds are empty', async () => {
    // No cash_balances rows (account_count 0) and no cost rows (cost_rows 0):
    // both inputs are unknown → runwayDays null, burnStatus 'unknown'. NEVER a
    // fabricated 90/0.
    const { db } = makeStubDb({ tableRows: { sales: [] } });
    db.execute = routeRunwayExecute(db.execute, {
      cash: [{ cash_total: '0', account_count: 0 }],
      burn: [{ daily_burn: '0', cost_rows: 0 }],
    });
    const brief = await composeOwnerBrief(db, 't1');
    expect(brief.cashRunway.cashOnHandTzs).toBeNull();
    expect(brief.cashRunway.netDailyBurnTzs).toBeNull();
    expect(brief.cashRunway.runwayDays).toBeNull();
    expect(brief.cashRunway.burnStatus).toBe('unknown');
  });

  it('returns the NO-BURN sentinel when the estate is net cash-positive', async () => {
    // A real treasury balance + a real cost feed that nets to ≤ 0 burn (e.g.
    // refunds/credits outweigh spend) → no finite runway: runwayDays null,
    // burnStatus 'no_burn'. NOT 90, NOT ∞.
    const { db } = makeStubDb({ tableRows: { sales: [] } });
    db.execute = routeRunwayExecute(db.execute, {
      cash: [{ cash_total: '500000000', account_count: 2 }],
      burn: [{ daily_burn: '-2000000', cost_rows: 5 }],
    });
    const brief = await composeOwnerBrief(db, 't1');
    expect(brief.cashRunway.cashOnHandTzs).toBe(500_000_000);
    expect(brief.cashRunway.netDailyBurnTzs).toBe(-2_000_000);
    expect(brief.cashRunway.runwayDays).toBeNull();
    expect(brief.cashRunway.burnStatus).toBe('no_burn');
  });

  it('returns empty decisions slot when the SQL helper raises', async () => {
    // Construct a DB whose execute() throws when grievances/decisions
    // queries hit — confirms the slot wraps its error path.
    const { db } = makeStubDb({});
    db.execute = async (q: unknown) => {
      // Mirror the in-stub sqlText extractor: walk Drizzle's queryChunks.
      function extract(query: unknown): string {
        if (!query || typeof query !== 'object') return '';
        const queryObj = query as { queryChunks?: unknown };
        if (!Array.isArray(queryObj.queryChunks)) return '';
        let out = '';
        for (const chunk of queryObj.queryChunks) {
          if (typeof chunk === 'string') out += chunk;
          else if (chunk && typeof chunk === 'object') {
            const c = chunk as { value?: unknown };
            if (typeof c.value === 'string') out += c.value;
            else if (Array.isArray(c.value)) out += c.value.filter((v) => typeof v === 'string').join('');
            else if (Array.isArray((chunk as any).queryChunks)) out += extract(chunk);
          }
        }
        return out;
      }
      const text = extract(q);
      if (text.includes('incidents') && !text.toUpperCase().includes('INSERT')) {
        throw new Error('simulated db error');
      }
      return { rows: [] };
    };
    const brief = await composeOwnerBrief(db, 't1');
    expect(brief.decisions.pendingCount).toBe(0);
    expect(brief.decisions.items).toEqual([]);
  });
});

describe('computeCashRunway() — the REAL runway (guards the old degenerate 90)', () => {
  it('a BURNING estate yields cash / burn — not the constant 90', () => {
    // 500M cash, 5M/day burn → 100 days. The degenerate formula would have
    // returned 90 regardless of the actual numbers.
    const r = computeCashRunway({
      cashOnHandTzs: 500_000_000,
      netDailyBurnTzs: 5_000_000,
    });
    expect(r.burnStatus).toBe('burning');
    expect(r.runwayDays).toBe(100);
  });

  it('floors the day count (never rounds a partial day up)', () => {
    // 100 / 9 = 11.11… → floor → 11 (you cannot bank the 12th day).
    const r = computeCashRunway({ cashOnHandTzs: 100, netDailyBurnTzs: 9 });
    expect(r.runwayDays).toBe(11);
  });

  it('a NET-POSITIVE estate (burn ≤ 0) yields the no-burn sentinel, not 90/∞', () => {
    for (const netDailyBurnTzs of [0, -1, -5_000_000]) {
      const r = computeCashRunway({ cashOnHandTzs: 500_000_000, netDailyBurnTzs });
      expect(r.burnStatus).toBe('no_burn');
      expect(r.runwayDays).toBeNull();
    }
  });

  it('missing inputs (null / non-finite) yield an honest unknown, never a number', () => {
    const cases = [
      { cashOnHandTzs: null, netDailyBurnTzs: 5_000_000 },
      { cashOnHandTzs: 500_000_000, netDailyBurnTzs: null },
      { cashOnHandTzs: null, netDailyBurnTzs: null },
      { cashOnHandTzs: Number.NaN, netDailyBurnTzs: 5_000_000 },
      { cashOnHandTzs: 500_000_000, netDailyBurnTzs: Number.POSITIVE_INFINITY },
    ];
    for (const c of cases) {
      const r = computeCashRunway(c);
      expect(r.burnStatus).toBe('unknown');
      expect(r.runwayDays).toBeNull();
    }
  });

  it('never returns a negative runway (cash ≤ 0 with real burn floors at 0)', () => {
    const r = computeCashRunway({ cashOnHandTzs: 0, netDailyBurnTzs: 5_000_000 });
    expect(r.burnStatus).toBe('burning');
    expect(r.runwayDays).toBe(0);
  });
});
