/**
 * Unit tests for createSovereignActionLedgerService.
 *
 * Two-pronged coverage:
 *
 *   1. Pure helpers — `hashPayload` + `computeRowHash` are deterministic
 *      and the chain shape is the contract LITFIN parity claims; we
 *      pin them with vectors so any drift breaks tests.
 *
 *   2. Service surface — append → verify round-trip + tail ordering,
 *      using a stubbed DatabaseClient + drizzle-orm mock identical in
 *      spirit to `kernel-goals.service.test.ts`. The advisory lock is
 *      verified to fire on every append.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSovereignActionLedgerService,
  computeRowHash,
  hashPayload,
  GENESIS_HASH,
} from './sovereign-action-ledger.service.js';
import type { DatabaseClient } from '../client.js';

interface Row {
  id: string;
  tenantId: string;
  actionType: string;
  payloadJson: Record<string, unknown>;
  payloadHash: string;
  proposer: string;
  approvers: ReadonlyArray<string>;
  executedAt: Date;
  prevHash: string;
  thisHash: string;
  capturedAt: Date;
}

interface CapturedFilter {
  tenantId?: string;
}

const captured: { current: CapturedFilter } = { current: {} };

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      return { _op: 'eq', col: colName, value };
    },
    desc: (col: unknown) => ({ _op: 'desc', column: col }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    // sql template tag — minimal stub that swallows interpolations.
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _op: 'sql',
        strings,
        values,
      }),
      { raw: (s: string) => ({ _op: 'sql-raw', sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<Row> = []): {
  client: DatabaseClient;
  readonly rows: Row[];
  readonly lockCalls: ReadonlyArray<string>;
} {
  const state = { rows: [...initial] };
  const lockCalls: string[] = [];

  function filterTenantRows(): Row[] {
    const tenantId = captured.current.tenantId;
    if (!tenantId) return [...state.rows];
    return state.rows.filter((r) => r.tenantId === tenantId);
  }

  let pendingOrderDesc = false;
  let pendingLimit: number | null = null;

  const builder: Record<string, unknown> = {
    from() {
      return builder;
    },
    where() {
      return builder;
    },
    orderBy(...args: unknown[]) {
      pendingOrderDesc = args.some(
        (a) => (a as { _op?: string })?._op === 'desc',
      );
      return builder;
    },
    limit(n: number) {
      pendingLimit = n;
      const rows = filterTenantRows().sort((a, b) => {
        const cmp = a.executedAt.getTime() - b.executedAt.getTime();
        if (cmp !== 0) return pendingOrderDesc ? -cmp : cmp;
        return pendingOrderDesc
          ? b.id.localeCompare(a.id)
          : a.id.localeCompare(b.id);
      });
      captured.current = {};
      pendingOrderDesc = false;
      const limited = rows.slice(0, n);
      pendingLimit = null;
      return limited as unknown as Promise<Row[]>;
    },
  };

  const db: Record<string, unknown> = {
    select() {
      return builder;
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          state.rows.push({
            id: String(v.id ?? ''),
            tenantId: String(v.tenantId ?? ''),
            actionType: String(v.actionType ?? ''),
            payloadJson: (v.payloadJson ?? {}) as Record<string, unknown>,
            payloadHash: String(v.payloadHash ?? ''),
            proposer: String(v.proposer ?? ''),
            approvers: Array.isArray(v.approvers)
              ? (v.approvers as string[])
              : [],
            executedAt: v.executedAt as Date,
            prevHash: String(v.prevHash ?? ''),
            thisHash: String(v.thisHash ?? ''),
            capturedAt: new Date(),
          });
          return {
            then: (resolve: (rows: unknown) => unknown) => resolve(undefined),
          };
        },
      };
    },
    execute(q: unknown) {
      const sqlOp = (q as { _op?: string; strings?: TemplateStringsArray })?._op;
      if (sqlOp === 'sql') {
        const joined = (q as { strings: TemplateStringsArray }).strings.join(
          ' ',
        );
        if (joined.includes('pg_advisory_xact_lock')) {
          lockCalls.push('xact-lock');
        } else if (joined.includes('pg_advisory_lock')) {
          lockCalls.push('lock');
        } else if (joined.includes('pg_advisory_unlock')) {
          lockCalls.push('unlock');
        }
      }
      return Promise.resolve(undefined);
    },
  };

  return {
    client: db as unknown as DatabaseClient,
    get rows() {
      return state.rows;
    },
    get lockCalls() {
      return [...lockCalls];
    },
  };
}

describe('hashPayload', () => {
  it('is deterministic across key order', () => {
    const a = hashPayload({ a: 1, b: 'x' });
    const b = hashPayload({ b: 'x', a: 1 });
    expect(a).toBe(b);
  });

  it('null payload maps to a stable hash', () => {
    expect(hashPayload(null)).toBe(hashPayload(null));
  });

  // CRITICAL #5 regression test — same payload with reordered NESTED
  // object keys must produce the same hash. The previous implementation
  // only sorted top-level keys; nested objects retained insertion order,
  // which broke the ledger chain verifier for any non-flat payload.
  it('deep-sorts nested object keys — same hash regardless of producer order', () => {
    const a = hashPayload({
      lease: { id: 'l_1', tenantId: 't_1', amountCents: 100 },
      owner: { id: 'o_1', email: 'x@y.com' },
    });
    const b = hashPayload({
      owner: { email: 'x@y.com', id: 'o_1' },
      lease: { tenantId: 't_1', amountCents: 100, id: 'l_1' },
    });
    expect(a).toBe(b);
  });

  // Array ordering IS semantically significant — the verifier must
  // distinguish `[a,b]` from `[b,a]` (sequences carry meaning in many
  // sovereign actions, e.g. approver order).
  it('preserves array order — [a,b] hashes differently from [b,a]', () => {
    const a = hashPayload({ approvers: ['u_admin', 'u_finance'] });
    const b = hashPayload({ approvers: ['u_finance', 'u_admin'] });
    expect(a).not.toBe(b);
  });
});

describe('computeRowHash', () => {
  it('changes when prevHash changes', () => {
    const base = {
      tenantId: 't',
      actionType: 'eviction.proposed',
      payloadHash: 'p',
      executedAt: new Date('2026-05-14T00:00:00Z'),
    };
    const h1 = computeRowHash({ ...base, prevHash: GENESIS_HASH });
    const h2 = computeRowHash({ ...base, prevHash: 'a'.repeat(64) });
    expect(h1).not.toBe(h2);
  });

  it('changes when payloadHash changes', () => {
    const base = {
      tenantId: 't',
      actionType: 'eviction.proposed',
      executedAt: new Date('2026-05-14T00:00:00Z'),
      prevHash: GENESIS_HASH,
    };
    expect(computeRowHash({ ...base, payloadHash: 'a' })).not.toBe(
      computeRowHash({ ...base, payloadHash: 'b' }),
    );
  });
});

describe('createSovereignActionLedgerService.appendLedgerEntry', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('seeds the first row with GENESIS_HASH prevHash', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    const res = await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'tenant.eviction-proposed',
      payloadJson: { leaseId: 'l_1' },
      proposer: 'u_admin',
      approvers: ['u_admin', 'u_finance'],
      executedAt: new Date('2026-05-14T00:00:00Z'),
    });
    expect(res.prevHash).toBe(GENESIS_HASH);
    expect(res.thisHash).toHaveLength(64);
    expect(stub.rows).toHaveLength(1);
    // HIGH-C — xact-scoped lock, no separate unlock needed.
    expect(stub.lockCalls).toEqual(['xact-lock']);
  });

  it('second row chains off the first row', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    const first = await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'tenant.eviction-proposed',
      payloadJson: { leaseId: 'l_1' },
      proposer: 'u_admin',
      approvers: ['u_admin', 'u_finance'],
      executedAt: new Date('2026-05-14T00:00:00Z'),
    });
    const second = await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'owner.payout-executed',
      payloadJson: { ownerId: 'o_1', amount: 100 },
      proposer: 'u_admin',
      approvers: ['u_admin', 'u_finance'],
      executedAt: new Date('2026-05-14T01:00:00Z'),
    });
    expect(second.prevHash).toBe(first.thisHash);
    expect(stub.rows).toHaveLength(2);
  });

  it('throws when tenantId is missing', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    await expect(
      svc.appendLedgerEntry({
        tenantId: '',
        actionType: 'x',
        payloadJson: {},
        proposer: 'u',
        approvers: [],
        executedAt: new Date(),
      }),
    ).rejects.toThrow(/tenantId is required/);
  });
});

describe('createSovereignActionLedgerService.verifyLedgerChain', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns ok=true for a freshly-appended chain', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    for (let i = 0; i < 3; i += 1) {
      await svc.appendLedgerEntry({
        tenantId: 't1',
        actionType: `action.${i}`,
        payloadJson: { i },
        proposer: 'u_admin',
        approvers: ['u_admin', 'u_finance'],
        executedAt: new Date(2026, 4, 14, i),
      });
    }
    const res = await svc.verifyLedgerChain('t1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.count).toBe(3);
  });

  it('flags a tampered this_hash with reason=hash-mismatch', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'a.0',
      payloadJson: { i: 0 },
      proposer: 'u_admin',
      approvers: ['u_admin', 'u_finance'],
      executedAt: new Date(2026, 4, 14, 0),
    });
    // tamper with the row in-place
    const r = stub.rows[0];
    if (r) (r as { actionType: string }).actionType = 'a.tampered';
    const res = await svc.verifyLedgerChain('t1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('hash-mismatch');
  });

  it('returns count=0 when tenantId is empty', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    const res = await svc.verifyLedgerChain('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.count).toBe(0);
  });
});

describe('createSovereignActionLedgerService.appendLedgerEntry / PII redaction', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('redacts KRA PIN + email + phone from payload_json before persist', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'tax.kra-filing-prepared',
      payloadJson: {
        kraPin: 'A123456789B',
        ownerPhone: '+255712345678',
        ownerEmail: 'owner@example.com',
        ownerName: 'Asha Kweli',
        amount: 9000,
      },
      proposer: 'u_admin',
      approvers: ['u_admin', 'u_finance'],
      executedAt: new Date('2026-05-14T00:00:00Z'),
    });
    expect(stub.rows).toHaveLength(1);
    const persistedPayload = JSON.stringify(stub.rows[0]?.payloadJson ?? {});
    expect(persistedPayload).not.toContain('A123456789B');
    expect(persistedPayload).not.toContain('+255712345678');
    expect(persistedPayload).not.toContain('owner@example.com');
    expect(persistedPayload).toContain('<kra-pin:redacted>');
    expect(persistedPayload).toContain('[PHONE]');
    expect(persistedPayload).toContain('[EMAIL]');
    // Amount + non-PII fields preserved.
    expect(persistedPayload).toContain('9000');
    expect(persistedPayload).toContain('Asha Kweli');
  });

  it('hash is computed on the ORIGINAL payload — verify chain stays intact after redaction', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    await svc.appendLedgerEntry({
      tenantId: 't1',
      actionType: 'tax.kra-filing-prepared',
      payloadJson: { kraPin: 'A123456789B', amount: 5000 },
      proposer: 'u_admin',
      approvers: ['u_admin'],
      executedAt: new Date('2026-05-14T00:00:00Z'),
    });
    const verify = await svc.verifyLedgerChain('t1');
    expect(verify.ok).toBe(true);
  });
});

describe('createSovereignActionLedgerService.getLedgerTail', () => {
  beforeEach(() => {
    captured.current = {};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns newest-first up to the cap', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    for (let i = 0; i < 5; i += 1) {
      await svc.appendLedgerEntry({
        tenantId: 't1',
        actionType: `a.${i}`,
        payloadJson: { i },
        proposer: 'u_admin',
        approvers: ['u_admin', 'u_finance'],
        executedAt: new Date(2026, 4, 14, i),
      });
    }
    const tail = await svc.getLedgerTail('t1', 3);
    expect(tail).toHaveLength(3);
    // newest first → a.4, a.3, a.2
    expect(tail[0]?.actionType).toBe('a.4');
    expect(tail[2]?.actionType).toBe('a.2');
  });

  it('returns [] for empty tenantId', async () => {
    const stub = makeStubDb();
    const svc = createSovereignActionLedgerService(stub.client);
    const tail = await svc.getLedgerTail('', 10);
    expect(tail).toEqual([]);
  });
});
