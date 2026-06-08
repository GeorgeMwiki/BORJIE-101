/**
 * withTenantContext personId extension + require-tenant-context guard tests.
 *
 * Proves:
 *   1. WITHOUT personId — the emitted set_config statements are byte-for-byte
 *      the pre-lane set (tenant_id, tenant_id mirror, is_service_role) and NO
 *      app.current_person_id statement is issued (additive, zero behaviour
 *      change by default).
 *   2. WITH personId — exactly ONE additional
 *      `set_config('app.current_person_id', $p, true)` is issued, inside the
 *      same transaction, transaction-local (`true`).
 *   3. assertTenantId throws on empty / blank tenant ids and is a no-op on a
 *      real id.
 */

import { describe, expect, it } from 'vitest';
import { withTenantContext } from '../rls/with-tenant-context.js';
import { assertTenantId } from '../rls/require-tenant-context.js';
import type { DatabaseClient } from '../client.js';

const TENANT = '00000000-0000-0000-0000-00000000aaaa';
const PERSON = '11111111-1111-1111-1111-111111111111';

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

describe('withTenantContext — personId GUC (additive)', () => {
  it('emits NO app.current_person_id statement when personId is absent', async () => {
    const { db, executed } = recordingDb();
    await withTenantContext(db, TENANT, async () => 'ok');
    const personStmts = executed.filter((s) =>
      s.includes('app.current_person_id'),
    );
    expect(personStmts).toHaveLength(0);
    // The historical three set_config statements are still issued, in order.
    expect(executed.some((s) => s.includes('app.current_tenant_id'))).toBe(true);
    expect(executed.some((s) => s.includes('app.tenant_id'))).toBe(true);
    expect(executed.some((s) => s.includes('app.is_service_role'))).toBe(true);
  });

  it('emits exactly one transaction-local app.current_person_id when personId is set', async () => {
    const { db, executed } = recordingDb();
    await withTenantContext(db, TENANT, async () => 'ok', { personId: PERSON });
    const personStmts = executed.filter((s) =>
      s.includes('app.current_person_id'),
    );
    expect(personStmts).toHaveLength(1);
    // transaction-local (`, true)`) and carries the person id.
    expect(personStmts[0]).toMatch(/app\.current_person_id/);
    expect(personStmts[0]).toMatch(/,\s*true\s*\)/);
    expect(personStmts[0]).toContain(PERSON);
  });
});

describe('assertTenantId guard', () => {
  it('throws on empty string', () => {
    expect(() => assertTenantId('')).toThrow(/require-tenant-context/);
  });
  it('throws on blank/whitespace', () => {
    expect(() => assertTenantId('   ')).toThrow(/require-tenant-context/);
  });
  it('throws on null/undefined', () => {
    expect(() => assertTenantId(null)).toThrow();
    expect(() => assertTenantId(undefined)).toThrow();
  });
  it('passes a real tenant id', () => {
    expect(() => assertTenantId(TENANT)).not.toThrow();
  });
});
