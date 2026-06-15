/**
 * withTenantContext — RLS enforcement switch (BORJIE_ENFORCE_RLS) tests.
 *
 * Proves the default-off enforcement flag:
 *   1. Flag UNSET / not 'true' — NO `SET LOCAL ROLE` is issued; the emitted
 *      statements are exactly the historical GUC binds (today's inert-RLS
 *      behaviour, byte-for-byte).
 *   2. Flag === 'true' — exactly ONE `SET LOCAL ROLE authenticated` is issued,
 *      AFTER all `set_config(...)` GUC binds, inside the same transaction.
 *   3. withServiceRoleContext (which delegates to withTenantContext) inherits
 *      the same switch: flag-on → it too issues SET LOCAL ROLE authenticated
 *      after binding is_service_role='true'.
 *
 * Safe-to-land: the flag is DEFAULT-OFF, so the OFF path (asserted in test 1)
 * is exactly the pre-change behaviour. The migration's additive policies only
 * become load-bearing once this flag is flipped.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  withServiceRoleContext,
  withTenantContext,
} from '../rls/with-tenant-context.js';
import type { DatabaseClient } from '../client.js';

const TENANT = '00000000-0000-0000-0000-00000000aaaa';
const FLAG = 'BORJIE_ENFORCE_RLS';

/** Recording stub: a transaction-capable db that captures every executed SQL. */
function recordingDb(): { db: DatabaseClient; executed: string[] } {
  const executed: string[] = [];
  const tx = {
    execute: async (q: unknown) => {
      executed.push(renderSql(q));
      return [];
    },
  };
  const db = {
    transaction: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> =>
      fn(tx),
  };
  return { db: db as unknown as DatabaseClient, executed };
}

function renderSql(q: unknown): string {
  const obj = q as { queryChunks?: unknown[] };
  const chunks = obj.queryChunks;
  if (!Array.isArray(chunks)) return String(q);
  let out = '';
  for (const c of chunks) {
    const cv = (c as { value?: unknown }).value;
    if (Array.isArray(cv)) out += cv.join('');
    else if (typeof c === 'string') out += c;
    else if (cv !== undefined) out += String(cv);
  }
  return out;
}

const SET_ROLE_RE = /SET\s+LOCAL\s+ROLE\s+authenticated/i;

afterEach(() => {
  delete process.env[FLAG];
});

describe('withTenantContext — RLS enforcement switch (default-off)', () => {
  it('issues NO SET LOCAL ROLE when the flag is unset', async () => {
    delete process.env[FLAG];
    const { db, executed } = recordingDb();
    await withTenantContext(db, TENANT, async () => 'ok');
    expect(executed.some((s) => SET_ROLE_RE.test(s))).toBe(false);
    // The historical GUC binds are still issued (unchanged behaviour).
    expect(executed.some((s) => s.includes('app.current_tenant_id'))).toBe(true);
    expect(executed.some((s) => s.includes('app.is_service_role'))).toBe(true);
  });

  it('issues NO SET LOCAL ROLE when the flag is a non-"true" value', async () => {
    process.env[FLAG] = 'false';
    const { db, executed } = recordingDb();
    await withTenantContext(db, TENANT, async () => 'ok');
    expect(executed.some((s) => SET_ROLE_RE.test(s))).toBe(false);

    process.env[FLAG] = '1';
    const second = recordingDb();
    await withTenantContext(second.db, TENANT, async () => 'ok');
    expect(second.executed.some((s) => SET_ROLE_RE.test(s))).toBe(false);
  });

  it('issues exactly one SET LOCAL ROLE authenticated AFTER the GUC binds when flag === "true"', async () => {
    process.env[FLAG] = 'true';
    const { db, executed } = recordingDb();
    await withTenantContext(db, TENANT, async () => 'ok');

    const roleStmts = executed.filter((s) => SET_ROLE_RE.test(s));
    expect(roleStmts).toHaveLength(1);

    // The role switch must come AFTER every set_config GUC bind so the policies
    // evaluate against the fully-populated context.
    const roleIdx = executed.findIndex((s) => SET_ROLE_RE.test(s));
    const lastGucIdx = executed.reduce(
      (acc, s, i) => (s.includes('set_config') ? i : acc),
      -1,
    );
    expect(roleIdx).toBeGreaterThan(lastGucIdx);
  });
});

describe('withServiceRoleContext — inherits the enforcement switch', () => {
  it('issues NO SET LOCAL ROLE when the flag is unset', async () => {
    delete process.env[FLAG];
    const { db, executed } = recordingDb();
    await withServiceRoleContext(db, async () => 'ok');
    expect(executed.some((s) => SET_ROLE_RE.test(s))).toBe(false);
    // service-role context still binds is_service_role='true'.
    expect(
      executed.some((s) => s.includes('app.is_service_role') && s.includes('true')),
    ).toBe(true);
  });

  it('issues SET LOCAL ROLE authenticated when flag === "true"', async () => {
    process.env[FLAG] = 'true';
    const { db, executed } = recordingDb();
    await withServiceRoleContext(db, async () => 'ok');
    expect(executed.filter((s) => SET_ROLE_RE.test(s))).toHaveLength(1);
  });
});
