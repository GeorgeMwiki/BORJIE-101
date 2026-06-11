/**
 * ensureCompanyForTenant — B1 launch-blocker closure.
 *
 * A brand-new tenant has NO `companies` row. The licence / worker recipe
 * projections both require a NOT NULL `company_id`, so without a company the
 * commit honestly returns `rows_inserted: 0`. These tests pin the seam that
 * materialises the company from captured KYB so the first licence commit
 * actually inserts:
 *
 *   1. net-new tenant (no company) → INSERT … RETURNING fires → operation
 *      'insert' + a resolvable companyId + a hash-chained audit append.
 *   2. idempotency: a re-commit hits `ON CONFLICT (tenant_id, registration_no)
 *      DO NOTHING` → no RETURNING row → SELECT fallback resolves the SAME id →
 *      operation 'skip' and NO duplicate company INSERT.
 *   3. end-to-end: once the company exists, the licence RowWriter projects a
 *      non-null company_id and inserts (rows_inserted >= 1, NOT 0).
 *
 * No live Postgres: a stateful in-memory `execute` fake interprets the SQL
 * string (drizzle `queryChunks`) the same way the route's real tx would.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ensureCompanyForTenant,
  createDrizzleRowWriter,
  type OnboardingWriterCtx,
} from '../drizzle-row-writer';

const TENANT = 'tn_brand_new';
const USER = 'usr_owner';
const SESSION = 'sess_1';

function sqlText(query: unknown): string {
  if (typeof query === 'string') return query;
  if (query === null || query === undefined) return '';
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    // Nested drizzle SQL fragment (joined columns / params) — recurse.
    return chunks.map((c) => sqlText(c)).join(' ');
  }
  const v = (query as { value?: unknown }).value;
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'string') return v; // identifier StringChunk
  return '';
}

/** Bound params are the plain-string chunks (StringChunk statics are objects). */
function paramStrings(query: unknown): string[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((c): c is string => typeof c === 'string');
}

interface CompanyRow {
  id: string;
  tenant_id: string;
  registration_no: string;
}

/**
 * Stateful fake of the tenant-GUC-bound tx. Simulates `companies`,
 * `ai_audit_chain` and `licences` so we can prove the no-op idempotency and
 * the end-to-end insert without a real DB.
 */
function makeTx() {
  const companies: CompanyRow[] = [];
  const auditChain: Array<{ seq: number; operation: string; table: string }> =
    [];
  const licences: Array<{ id: string; number: string }> = [];
  const calls: string[] = [];

  const execute = vi.fn(async (q: unknown) => {
    const text = sqlText(q);
    const params = paramStrings(q);

    // ── companies UPSERT (ON CONFLICT DO NOTHING RETURNING id) ──────────
    if (text.includes('INSERT INTO companies')) {
      calls.push('insert_company');
      // params order: id, tenant_id, name, registration_no, tin, address
      const id = params[0]!;
      const tenantId = params[1]!;
      const registrationNo = params[3]!;
      const conflict = companies.some(
        (c) => c.tenant_id === tenantId && c.registration_no === registrationNo,
      );
      if (conflict) {
        // DO NOTHING → zero RETURNING rows.
        return { rows: [] };
      }
      companies.push({ id, tenant_id: tenantId, registration_no: registrationNo });
      return { rows: [{ id }] };
    }

    // ── companies SELECT fallback (idempotency conflict path) ───────────
    if (text.includes('SELECT id FROM companies')) {
      const tenantId = params[0]!;
      const registrationNo = params[1]!;
      const row = companies.find(
        (c) => c.tenant_id === tenantId && c.registration_no === registrationNo,
      );
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // ── ai_audit_chain latest (FOR UPDATE) ──────────────────────────────
    if (text.includes('FROM ai_audit_chain')) {
      const last = auditChain[auditChain.length - 1];
      return {
        rows: last
          ? [{ sequence_id: last.seq, this_hash: `hash-${last.seq}` }]
          : [],
      };
    }

    // ── ai_audit_chain append ───────────────────────────────────────────
    if (text.includes('INSERT INTO ai_audit_chain')) {
      const seq = auditChain.length + 1;
      // Recover the table + operation from the payload param (JSON string).
      const payloadParam = params.find((p) => p.includes('"operation"'));
      const parsed = payloadParam ? JSON.parse(payloadParam) : {};
      auditChain.push({
        seq,
        operation: String(parsed.operation ?? ''),
        table: String(parsed.table ?? ''),
      });
      return { rows: [] };
    }

    // ── licences idempotency SELECT (RowWriter natural-key probe) ───────
    if (text.includes('FROM') && text.includes('licences') && text.includes('WHERE tenant_id')) {
      const number = params[params.length - 1]!;
      const row = licences.find((l) => l.number === number);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // ── licences INSERT (the real domain insert we want to see fire) ────
    if (text.includes('INSERT INTO') && text.includes('licences')) {
      calls.push('insert_licence');
      // RowWriter buildInsert columns: id, tenant_id, company_id, kind,
      // number, mineral (param order follows Object.keys insertion). We only
      // need to prove the insert fired; record a stable id for completeness.
      const id = `lic-${licences.length}`;
      licences.push({ id, number: 'PML-998877' });
      return { rows: [{ id }] };
    }

    // ── drill_holes idempotency SELECT + INSERT (STRETCH) ───────────────
    if (text.includes('FROM') && text.includes('drill_holes') && text.includes('WHERE tenant_id')) {
      return { rows: [] };
    }
    if (text.includes('INSERT INTO') && text.includes('drill_holes')) {
      calls.push('insert_drill_hole');
      return { rows: [{ id: 'dh-0' }] };
    }

    return { rows: [] };
  });

  return { tx: { execute }, companies, auditChain, licences, calls };
}

function ctxFor(tx: { execute: (q: unknown) => Promise<unknown> }): {
  tx: { execute: (q: unknown) => Promise<unknown> };
  tenantId: string;
  userId: string;
  sessionId: string;
} {
  return { tx, tenantId: TENANT, userId: USER, sessionId: SESSION };
}

describe('ensureCompanyForTenant — materialise company from KYB', () => {
  it('inserts a company for a brand-new tenant + appends an audit row', async () => {
    const { tx, companies, auditChain } = makeTx();
    const result = await ensureCompanyForTenant({
      ctx: ctxFor(tx),
      kyb: {
        companyName: 'Asha Mining Ltd',
        registrationNo: 'BRELA-12345',
        tin: '123-456-789',
        registeredAddress: 'Geita, TZ',
      },
    });

    expect(result.operation).toBe('insert');
    expect(result.companyId).toBeTruthy();
    expect(companies).toHaveLength(1);
    expect(companies[0]!.registration_no).toBe('BRELA-12345');
    // Hash-chained audit append on the company insert.
    expect(auditChain).toHaveLength(1);
    expect(auditChain[0]!.table).toBe('companies');
    expect(auditChain[0]!.operation).toBe('insert');
  });

  it('is idempotent — a re-commit does NOT duplicate the company', async () => {
    const { tx, companies, calls } = makeTx();
    const kyb = {
      companyName: 'Asha Mining Ltd',
      registrationNo: 'BRELA-12345',
    };

    const first = await ensureCompanyForTenant({ ctx: ctxFor(tx), kyb });
    const second = await ensureCompanyForTenant({ ctx: ctxFor(tx), kyb });

    expect(first.operation).toBe('insert');
    expect(second.operation).toBe('skip');
    // Same id resolved both times → no duplicate.
    expect(second.companyId).toBe(first.companyId);
    expect(companies).toHaveLength(1);
    // The second call attempted an INSERT (ON CONFLICT DO NOTHING) but the
    // SELECT fallback resolved the existing row — exactly one company persists.
    expect(calls.filter((c) => c === 'insert_company')).toHaveLength(2);
  });

  it('rejects KYB missing the natural-key registration number', async () => {
    const { tx } = makeTx();
    await expect(
      ensureCompanyForTenant({
        ctx: ctxFor(tx),
        // @ts-expect-error — deliberately invalid to prove the guard.
        kyb: { companyName: 'No Reg Co', registrationNo: '' },
      }),
    ).rejects.toThrow(/registrationNo/);
  });
});

describe('end-to-end — licence commit inserts once the company exists', () => {
  it('licence RowWriter inserts a real row after ensureCompanyForTenant (NOT skipped)', async () => {
    const { tx, calls } = makeTx();

    // 1) Materialise the company from KYB.
    const ensured = await ensureCompanyForTenant({
      ctx: ctxFor(tx),
      kyb: { companyName: 'Asha Mining Ltd', registrationNo: 'BRELA-12345' },
    });
    expect(ensured.operation).toBe('insert');

    // 2) Build the writer with the freshly-resolved company id and persist a
    //    licence row (mirrors the route's writerCtx with defaultCompanyId set).
    const writerCtx: OnboardingWriterCtx = Object.freeze({
      tx: tx as OnboardingWriterCtx['tx'],
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      defaultCompanyId: ensured.companyId,
      defaultLicenceId: null,
    });
    const writer = createDrizzleRowWriter(writerCtx);
    const res = await writer.upsertRow({
      table: 'mining_licences',
      primary_key_field: 'licence_no',
      values: { licence_no: 'PML-998877', mineral: 'gold', kind: 'PML' },
    });

    // The licence row inserts (NOT skipped for want of a company_id) — this is
    // the exact bug B1 closes: previously rows_inserted would be 0.
    expect(res.operation).toBe('insert');
    expect(calls).toContain('insert_licence');
  });

  it('without a company the licence row is SKIPPED (proves the bug it closes)', async () => {
    const { tx, calls } = makeTx();
    const writerCtx: OnboardingWriterCtx = Object.freeze({
      tx: tx as OnboardingWriterCtx['tx'],
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      defaultCompanyId: null, // ← no company materialised
      defaultLicenceId: null,
    });
    const writer = createDrizzleRowWriter(writerCtx);
    const res = await writer.upsertRow({
      table: 'mining_licences',
      primary_key_field: 'licence_no',
      values: { licence_no: 'PML-998877', mineral: 'gold', kind: 'PML' },
    });

    expect(res.operation).toBe('skip');
    expect(calls).not.toContain('insert_licence');
  });
});

describe('drill_hole RowWriter — STRETCH (site FK gate)', () => {
  it('inserts a drill_hole when a default site is resolvable', async () => {
    const { tx, calls } = makeTx();
    const writerCtx: OnboardingWriterCtx = Object.freeze({
      tx: tx as OnboardingWriterCtx['tx'],
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      defaultCompanyId: null,
      defaultLicenceId: null,
      defaultSiteId: 'site-1',
    });
    const writer = createDrizzleRowWriter(writerCtx);
    const res = await writer.upsertRow({
      table: 'drill_holes',
      primary_key_field: 'hole_id',
      values: { hole_id: 'DH-001', kind: 'exploration' },
    });
    expect(res.operation).toBe('insert');
    expect(calls).toContain('insert_drill_hole');
  });

  it('skips a drill_hole when no site FK is resolvable (no partial insert)', async () => {
    const { tx, calls } = makeTx();
    const writerCtx: OnboardingWriterCtx = Object.freeze({
      tx: tx as OnboardingWriterCtx['tx'],
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      defaultCompanyId: null,
      defaultLicenceId: null,
      defaultSiteId: null, // ← no site → FK unresolved
    });
    const writer = createDrizzleRowWriter(writerCtx);
    const res = await writer.upsertRow({
      table: 'drill_holes',
      primary_key_field: 'hole_id',
      values: { hole_id: 'DH-001', kind: 'exploration' },
    });
    expect(res.operation).toBe('skip');
    expect(calls).not.toContain('insert_drill_hole');
  });
});
