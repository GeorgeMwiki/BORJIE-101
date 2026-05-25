/**
 * RLS GUC name-invariant test — Supabase audit F2 (2026-05-21).
 *
 * Closes the CRITICAL multi-tenant defence-in-depth gap surfaced in
 * the F2 audit finding: the `databaseMiddleware` MUST call
 * `set_config('app.current_tenant_id', ...)` — using the canonical
 * name that `public.current_app_tenant_id()` (migration 0172) reads.
 * Any drift here re-opens the silent-zero-rows failure mode where
 * RLS policies evaluate to NULL = <tenant_id> (which Postgres treats
 * as FALSE under RLS), turning every authenticated request into an
 * empty result set on ~70 tenant-scoped tables.
 *
 * The test pins three properties:
 *
 *   1) The middleware issues exactly one `set_config` call when the
 *      request carries an authenticated principal with a tenantId,
 *      and that call's first argument is the CANONICAL GUC name
 *      `app.current_tenant_id`. The inverse name (`app.tenant_id`)
 *      MUST NOT appear — a regression to the pre-0172 wiring would
 *      flip this assertion.
 *
 *   2) The tenantId value is passed through unmodified (no string
 *      interpolation into the SQL fragment — `set_config` parameterises
 *      it, defending against GUC-injection via a malicious JWT).
 *
 *   3) A request WITHOUT an authenticated tenantId issues NO
 *      `set_config` call (the helper then returns NULL and RLS
 *      fails closed by default).
 *
 * Design notes
 * ────────────
 * `database.execute(sql)` is the single wire-protocol exit from the
 * middleware. We replace `db` on the Hono context with a recording
 * stub that captures every `execute` invocation, then assert the
 * captured SQL string + bound parameters. This is intentionally
 * a contract test, not a live-Postgres test — the real DDL behaviour
 * of the helper is exercised by the migration runner and the
 * existing `packages/database/src/__tests__/rls-guc-bind.test.ts`
 * Pgbouncer-pooling simulator.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { databaseMiddleware } from '../database';

// ---------------------------------------------------------------------------
// Recording stub — captures every `execute(sql)` invocation. We
// record the rendered SQL plus the parameter list so the test can
// assert BOTH the canonical GUC name AND the parameterised binding.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly sqlText: string;
  readonly params: ReadonlyArray<unknown>;
}

interface DrizzleSqlLike {
  readonly queryChunks?: ReadonlyArray<{
    readonly value?: ReadonlyArray<string>;
    readonly type?: string;
  }>;
  // postgres.js / drizzle internal — the literal SQL string after
  // template assembly.
  toString?: () => string;
  // drizzle exposes the param list via this getter on the SQL builder.
  // Different versions surface it under different keys, so we check a
  // few.
  readonly params?: ReadonlyArray<unknown>;
  readonly values?: ReadonlyArray<unknown>;
}

function extractSqlAndParams(input: unknown): RecordedCall {
  // Drizzle's `sql` tagged template returns a `SQL` instance whose
  // internal representation is a `queryChunks` array of either
  // `StringChunk` (carries `.value: string[]`) or `Param` (carries
  // `.value: unknown` — the bound parameter). We walk that array,
  // concatenate the string chunks AND record the bound values
  // separately. `.toString()` on the raw SQL object does NOT yield
  // the rendered SQL (it returns `[object Object]`), so we cannot
  // rely on it as a fallback.
  const sqlObj = input as DrizzleSqlLike & {
    readonly queryChunks?: ReadonlyArray<{
      value?: unknown;
      readonly type?: string;
    }>;
  };

  // Walk queryChunks when present — covers the modern drizzle-orm
  // SQL representation used by the database middleware. The chunks
  // are a mix of `StringChunk` (carries `.value: string[]`) and `Param`
  // (carries `.value: unknown` — the bound parameter). Some interpolated
  // values become inline `SQL` wrapper objects with their own
  // `queryChunks`, so we recurse defensively.
  if (Array.isArray(sqlObj?.queryChunks)) {
    const stringParts: string[] = [];
    const params: unknown[] = [];
    const walk = (chunks: ReadonlyArray<unknown>): void => {
      for (const chunk of chunks) {
        // Drizzle's bare-interpolated values (e.g. `sql\`... ${tenantId} ...\``)
        // arrive as the value itself, NOT wrapped in a Param object. We
        // treat any non-object chunk as a parameter.
        if (
          chunk === null
          || typeof chunk === 'string'
          || typeof chunk === 'number'
          || typeof chunk === 'boolean'
          || typeof chunk === 'bigint'
        ) {
          params.push(chunk);
          stringParts.push(`$${params.length}`);
          continue;
        }
        if (typeof chunk !== 'object') continue;

        const chunkObj = chunk as { value?: unknown; queryChunks?: ReadonlyArray<unknown> };
        // Nested SQL wrapper: recurse into its own queryChunks.
        if (Array.isArray(chunkObj.queryChunks)) {
          walk(chunkObj.queryChunks);
          continue;
        }
        const value = chunkObj.value;
        if (Array.isArray(value)) {
          // StringChunk: array of literal SQL fragments.
          stringParts.push((value as string[]).join(''));
        } else if (value !== undefined && value !== null) {
          // Param chunk: capture the bound value AND emit a `$N`
          // placeholder in the rendered text.
          params.push(value);
          stringParts.push(`$${params.length}`);
        }
      }
    };
    walk(sqlObj.queryChunks as ReadonlyArray<unknown>);
    return { sqlText: stringParts.join(''), params };
  }

  // Fallback (defensive — not expected to fire with drizzle-orm).
  const sqlText =
    typeof sqlObj?.toString === 'function'
      ? sqlObj.toString()
      : String(input);
  const params =
    (sqlObj?.params as ReadonlyArray<unknown> | undefined) ??
    (sqlObj?.values as ReadonlyArray<unknown> | undefined) ??
    [];
  return { sqlText, params };
}

function makeRecordingDb(): {
  readonly execute: (sql: unknown) => Promise<{ rows: never[] }>;
  readonly calls: ReadonlyArray<RecordedCall>;
  clear: () => void;
} {
  const calls: RecordedCall[] = [];
  return {
    execute: async (sql: unknown) => {
      calls.push(extractSqlAndParams(sql));
      return { rows: [] };
    },
    get calls() {
      return calls;
    },
    clear: () => {
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Test app builder — mounts the real `databaseMiddleware` after a
// stub auth-context middleware that injects (or omits) the principal
// the way the production `authMiddleware` would. The recording stub
// is pre-populated on `c.set('db', ...)` so the middleware short-
// circuits its own client construction and uses our spy instead.
// ---------------------------------------------------------------------------

interface BuiltApp {
  readonly app: Hono;
  readonly db: ReturnType<typeof makeRecordingDb>;
}

function buildAppWithAuth(tenantId: string | null): BuiltApp {
  const db = makeRecordingDb();
  const app = new Hono();
  // Stub auth — emulates what `authMiddleware` writes on the ctx.
  app.use('*', async (c, next) => {
    if (tenantId !== null) {
      c.set('auth' as never, {
        tenantId,
        userId: 'u-fixture',
        role: 'ADMIN',
      } as never);
    }
    // Inject the recording stub BEFORE the real middleware runs so
    // it does not try to spin up a live postgres-js client. The real
    // middleware honours a pre-injected `db` (see comment near
    // `preInjectedDb` in services/api-gateway/src/middleware/database.ts).
    c.set('db' as never, db as never);
    c.set('repos' as never, {} as never);
    await next();
  });
  app.use('*', databaseMiddleware);
  app.get('/probe', (c) => c.json({ ok: true }));
  return { app, db };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANONICAL_GUC = 'app.current_tenant_id';
const LEGACY_GUC = 'app.tenant_id';
const TENANT_FIXTURE = '00000000-0000-0000-0000-00000000aaaa';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('databaseMiddleware — RLS GUC name invariant (F2)', () => {
  let original: string | undefined;
  beforeEach(() => {
    // The middleware short-circuits to mock-mode in production unless
    // a DATABASE_URL is set; the pre-injected `db` already bypasses
    // that path, but we keep NODE_ENV=test so the mock-mode JSON
    // shortcut also does not fire when no live DSN is present.
    original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
  });

  it('issues `set_config` against the canonical GUC name `app.current_tenant_id`', async () => {
    const { app, db } = buildAppWithAuth(TENANT_FIXTURE);

    const res = await app.request('/probe');
    const body = (await res.json()) as { ok?: boolean; error?: unknown };

    // Surface middleware errors before asserting call shape — a 500
    // here usually means the stub `execute` shape doesn't satisfy
    // drizzle's expected return signature. Surface that first so
    // the test failure is diagnostic.
    expect({ status: res.status, body }).toEqual({
      status: 200,
      body: { ok: true },
    });

    // Find the `set_config` call (it's the only execute() the
    // middleware issues — but we filter defensively in case future
    // wiring adds bookkeeping queries before/after).
    const setConfigCalls = db.calls.filter((c) =>
      c.sqlText.includes('set_config'),
    );
    expect(setConfigCalls.length).toBe(1);

    const sql = setConfigCalls[0]!.sqlText;
    // Canonical name must appear; legacy name must NOT.
    expect(sql).toContain(CANONICAL_GUC);
    expect(sql).not.toContain(LEGACY_GUC);
  });

  it('binds the tenant id as a parameter, not via string interpolation', async () => {
    const { app, db } = buildAppWithAuth(TENANT_FIXTURE);

    await app.request('/probe');

    const setConfigCalls = db.calls.filter((c) =>
      c.sqlText.includes('set_config'),
    );
    expect(setConfigCalls.length).toBe(1);
    const call = setConfigCalls[0]!;

    // The rendered SQL must NOT contain the tenant uuid literally —
    // that would indicate string interpolation, which is the
    // GUC-injection failure mode. The drizzle `sql` template inserts
    // a `$1` placeholder and binds the value separately.
    expect(call.sqlText).not.toContain(TENANT_FIXTURE);

    // Either the params array carries the tenant id, or (depending on
    // the drizzle internal shape) the SQL contains a placeholder
    // token. Both shapes prove the value is not interpolated.
    const paramsCarryTenant = call.params.includes(TENANT_FIXTURE);
    const hasPlaceholder = /\$\d+|\?/.test(call.sqlText);
    expect(paramsCarryTenant || hasPlaceholder).toBe(true);
  });

  it('issues NO `set_config` call when the request has no authenticated tenant (fail-closed)', async () => {
    const { app, db } = buildAppWithAuth(null);

    const res = await app.request('/probe');

    expect(res.status).toBe(200);

    const setConfigCalls = db.calls.filter((c) =>
      c.sqlText.includes('set_config'),
    );
    // No tenant context → middleware skips the GUC set, helper
    // returns NULL, RLS denies. This is the intentional fail-closed
    // path; a regression that defaulted the GUC to a hard-coded
    // tenant id would re-introduce cross-tenant leak risk.
    expect(setConfigCalls.length).toBe(0);
  });

  it('does not emit the legacy GUC name anywhere in the executed SQL surface', async () => {
    // Belt-and-braces check independent of the targeted `set_config`
    // assertion — guards against a future regression that introduces
    // a second helper call writing the legacy name, which would
    // re-create the inconsistency F2 closed.
    const { app, db } = buildAppWithAuth(TENANT_FIXTURE);

    await app.request('/probe');

    for (const call of db.calls) {
      expect(call.sqlText).not.toContain(LEGACY_GUC);
    }
  });

  // Restore NODE_ENV at the end of each test so subsequent unrelated
  // tests in the same process see the original value.
  afterEach(() => {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  });
});
